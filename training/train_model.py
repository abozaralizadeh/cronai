#!/usr/bin/env python3
"""
Train CronLex, CronAI's tiny on-device "word understanding" model.

What it learns
--------------
Given ONE lowercase token the user typed (e.g. "wensday", "evrey", "fiveteen",
"aftrenoon", "septmber"), predict the canonical schedule word it means
("wednesday", "every", "fifteen", "afternoon", "september") or __other__ when
the token is just part of the task description ("backup", "database", "fridge").

Architecture (≈ 80k params, int8-quantised to ~85 KB, runs in pure TypeScript):

    token -> hashed char n-grams (2..4) + whole-word feature   [FNV-1a, 2048 buckets]
          -> EmbeddingBag(mean, 2048 x 32)
          -> Dense(32 -> 64) + ReLU
          -> Dense(64 -> C) + softmax

Only numpy is required. Training data is fully synthetic: surface forms from
src/engine/lexicon.json plus realistic keyboard typos, and a list of ordinary
words / random strings labelled __other__.

Usage:  python3 training/train_model.py            (writes src/engine/model/weights.ts)
"""
from __future__ import annotations

import base64
import json
import os
import random
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEX_PATH = os.path.join(ROOT, "src", "engine", "lexicon.json")
OUT_PATH = os.path.join(ROOT, "src", "engine", "model", "weights.ts")

BUCKETS = 2048
EMB = 32
HID = 64
MIN_LEN = 4  # the model is only consulted for tokens of this length or more
SEED = 7

random.seed(SEED)
np.random.seed(SEED)

# --------------------------------------------------------------------------
# Feature hashing (must match src/engine/model/features.ts exactly)
# --------------------------------------------------------------------------

def fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def features(word: str) -> list[int]:
    s = "<" + word + ">"
    out = [fnv1a("W:" + word) % BUCKETS]
    for n in (2, 3, 4):
        for i in range(len(s) - n + 1):
            out.append(fnv1a(s[i : i + n]) % BUCKETS)
    return out


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------

KEYBOARD = [
    "qwertyuiop",
    "asdfghjkl",
    "zxcvbnm",
]
NEIGH: dict[str, str] = {}
for r, row in enumerate(KEYBOARD):
    for c, ch in enumerate(row):
        n = []
        if c > 0:
            n.append(row[c - 1])
        if c < len(row) - 1:
            n.append(row[c + 1])
        for rr in (r - 1, r + 1):
            if 0 <= rr < len(KEYBOARD):
                for cc in (c - 1, c, c + 1):
                    if 0 <= cc < len(KEYBOARD[rr]):
                        n.append(KEYBOARD[rr][cc])
        NEIGH[ch] = "".join(n)

PHONETIC = [("ph", "f"), ("ie", "ei"), ("ei", "ie"), ("dn", "nd"), ("er", "re"), ("ou", "o"),
            ("ay", "ey"), ("ur", "er"), ("th", "t"), ("ck", "k"), ("ee", "e"), ("y", "ie")]

OTHER_WORDS = """
backup backups database databases server servers report reports email emails send sending
deploy deployment build builds logs log rotate rotation clear cache caches update updates
notify notification notifications team meeting meetings standup coffee workout training
call phone mother father family invoice invoices payment payments rent bills water plants
garden clean cleanup purge prune archive archives export import snapshot snapshots metrics
health healthcheck heartbeat monitor monitoring alert alerts digest summary newsletter
reminder reminders remind refresh reindex index vacuum analyze compress upload download
fetch scrape crawl ingest pipeline pipelines release releases restart reboot shutdown
script scripts command commands function lambda worker workers queue queues process
customer customers users user account accounts orders order sales inventory stock price
prices weather forecast news feed feeds photos videos music playlist podcast podcasts
fridge friend friends fries frisbee mouth moth mother monitor monster money monkey mondo
tour tours your yours four hours? thus these those thirsty thirst thunder sunny sunset
sunshine sundae sundry saturn satin satire tuesdays? wedding wedge weed weeds weekly?
dairy diary dial dairy dates date data datum mainly manual minimal minimum minus minor
mines minecraft ours hourglass journal journey night? knight knights nigh light lights
eight? weight weights height evening? even event events ever everything everyone every?
ether other? others mother brother bother another anything something nothing
moment moments momentum mention month? mouths months? nope noon? noodle noodles
spring? springs string strings summer? summary summit simmer winter? winner window
windows autumn? author authors auto automatic august? augment augur august? march?
marching marsh match matches marches june? junk jungle julie jelly april? apricot
octopus octane novel novice november? decide decimal december? decade december?
afternoon? aftermath after? although always almost already also among amongst around
hello world please thanks thank kindly quickly slowly soon later early late earlier
first? second? third? last? next previous prior final finally start? starting? end? ending
reset rerun retry retries timeout timeouts token tokens secret secrets password key keys
image images file files folder folders directory directories bucket buckets storage disk
memory cpu load traffic network latency uptime downtime outage incident incidents
water watering feed feeding walk walking dog cat pets vitamin vitamins pills medicine
study studying reading writing coding meditation yoga running cycling swimming stretch
lunchbox breakfast dinner supper snack snacks meal meals grocery groceries shopping
backend frontend mobile android iphone ios website webpage blog post posts tweet tweets
instagram linkedin facebook twitter youtube slack discord telegram whatsapp github gitlab
invoice billing salary payroll taxes budget expenses expense receipts receipt
holiday holidays vacation vacations birthday birthdays anniversary sprint sprints today
tomorrow yesterday someday payday midweek friday? weekday? mondays? daylight dayton
sundance monthlong hourglass minutes? hours? teatime bedtime overtime downtime anytime
kubernetes docker container containers cluster clusters node nodes pod pods job jobs
""".split()
OTHER_WORDS = [w.strip("?") for w in OTHER_WORDS]


# Real-world misspellings people actually type (curated; boosted in training).
COMMON_MISSPELLINGS = {
    "wednesday": ["wensday", "wendsday", "wedensday", "wednsday", "wedsday", "wenesday"],
    "thursday": ["thrusday", "thurday", "thursay", "thusday"],
    "tuesday": ["tusday", "teusday", "tueday", "tuseday"],
    "saturday": ["saterday", "satarday", "saturady", "satuday"],
    "sunday": ["sunady", "sundy", "sundya"],
    "monday": ["mondya", "monady", "mondy"],
    "friday": ["freiday", "fridy", "firday", "frday"],
    "february": ["febuary", "feburary", "febraury"],
    "every": ["evey", "evrey", "everey", "evety", "eveyr"],
    "minute": ["minits", "mintues", "minuets", "munite", "minuts", "minite", "minutse"],
    "hour": ["hous", "hourse", "huors", "houres"],
    "morning": ["mornin", "morining", "mornign", "monring"],
    "evening": ["evning", "evenig", "eveing", "evenning"],
    "afternoon": ["afternon", "aftrenoon", "afetrnoon", "afternoom"],
    "midnight": ["midnite", "midnigth", "midnght"],
    "night": ["nite", "nigth", "nigt"],
    "twelfth": ["twelth", "twelveth"],
    "forty": ["fourty"],
    "fifteen": ["fiveteen", "fiftteen", "fifeen"],
    "ninth": ["nineth"],
    "quarter": ["quater", "quartr"],
    "quarterly": ["quaterly", "quartely"],
    "yearly": ["annualy", "anually", "yeraly"],
    "monthly": ["montly", "monthy", "monhtly"],
    "weekly": ["weekyl", "weakly", "weekley"],
    "daily": ["dialy", "daliy", "dayly"],
    "hourly": ["hourley", "houly", "horly"],
    "weekend": ["weeekend", "weekned", "wekend", "weekedns"],
    "weekday": ["weekdys", "wekday", "weekdya", "weedays"],
    "until": ["untill", "untl"],
    "between": ["betwen", "bewteen", "betwee", "inbetween"],
    "except": ["exept", "excpet"],
    "through": ["throught", "thorugh", "trough"],
    "september": ["septmber", "setpember"],
    "everyday": ["everday", "evryday"],
}


def typo(word: str, edits: int) -> str:
    w = list(word)
    for _ in range(edits):
        if len(w) < 3:
            break
        op = random.random()
        i = random.randrange(len(w))
        if op < 0.25:  # deletion
            del w[i]
        elif op < 0.45:  # substitution with keyboard neighbour
            ch = w[i]
            if ch in NEIGH:
                w[i] = random.choice(NEIGH[ch])
        elif op < 0.65:  # insertion (neighbour of current char or duplicate)
            ch = w[i]
            ins = random.choice(NEIGH.get(ch, ch) + ch)
            w.insert(i, ins)
        elif op < 0.85:  # transposition
            if i < len(w) - 1:
                w[i], w[i + 1] = w[i + 1], w[i]
        else:  # phonetic swap
            s = "".join(w)
            a, b = random.choice(PHONETIC)
            if a in s:
                s = s.replace(a, b, 1)
            w = list(s)
    return "".join(w)


def random_string() -> str:
    n = random.randint(4, 10)
    letters = "abcdefghijklmnopqrstuvwxyz"
    return "".join(random.choice(letters) for _ in range(n))


def build_dataset(lex: dict) -> tuple[list[str], list[tuple[str, int]]]:
    surfaces: dict[str, list[str]] = {}
    for canon, aliases in lex["words"].items():
        if len(canon) >= MIN_LEN:
            surfaces[canon] = [a for a in aliases if len(a) >= MIN_LEN and a.isalpha()]
            if canon not in surfaces[canon]:
                surfaces[canon].append(canon)
    for canon in lex["expansions"]:
        if len(canon) >= MIN_LEN:
            surfaces[canon] = [canon]
    for canon in list(lex["numbers"]) + list(lex["ordinals"]):
        if len(canon) >= MIN_LEN:
            surfaces[canon] = [canon]

    # prefixes for day/month names: "wednes", "septem", "febru"
    longnames = [k for k in lex["words"] if k.endswith("day") and len(k) > 6] + [
        "january", "february", "april", "august", "september", "october", "november", "december"]
    for k in longnames:
        for L in range(max(MIN_LEN + 1, len(k) - 4), len(k)):
            surfaces[k].append(k[:L])

    labels = sorted(surfaces) + ["__other__"]
    idx = {l: i for i, l in enumerate(labels)}

    exact_known = set()
    for aliases in lex["words"].values():
        exact_known.update(aliases)
    exact_known.update(lex["expansions"])
    exact_known.update(lex["numbers"])
    exact_known.update(lex["ordinals"])

    data: list[tuple[str, int]] = []
    for canon, forms in surfaces.items():
        for f in forms:
            for _ in range(12):
                data.append((f, idx[canon]))
            for _ in range(70):
                e = 1 if len(f) < 7 or random.random() < 0.6 else 2
                t = typo(f, e)
                if len(t) >= MIN_LEN and t not in exact_known:
                    data.append((t, idx[canon]))

    for canon, misses in COMMON_MISSPELLINGS.items():
        if canon in idx:
            for m in misses:
                for _ in range(30):
                    data.append((m, idx[canon]))
        else:
            print("WARN: misspelling target not a class:", canon)

    other = [w for w in OTHER_WORDS if len(w) >= MIN_LEN and w not in exact_known]
    for w in other:
        for _ in range(16):
            data.append((w, idx["__other__"]))
    for _ in range(6000):
        data.append((random_string(), idx["__other__"]))
    random.shuffle(data)
    return labels, data


# --------------------------------------------------------------------------
# Model (numpy, manual backprop, Adam)
# --------------------------------------------------------------------------

class Model:
    def __init__(self, C: int):
        self.E = (np.random.randn(BUCKETS, EMB) * 0.1).astype(np.float32)
        self.W1 = (np.random.randn(EMB, HID) * np.sqrt(2 / EMB)).astype(np.float32)
        self.b1 = np.zeros(HID, np.float32)
        self.W2 = (np.random.randn(HID, C) * np.sqrt(2 / HID)).astype(np.float32)
        self.b2 = np.zeros(C, np.float32)
        self.params = ["E", "W1", "b1", "W2", "b2"]
        self.m = {p: np.zeros_like(getattr(self, p)) for p in self.params}
        self.v = {p: np.zeros_like(getattr(self, p)) for p in self.params}
        self.t = 0

    def forward(self, feats: list[list[int]]):
        B = len(feats)
        X = np.zeros((B, EMB), np.float32)
        for i, f in enumerate(feats):
            X[i] = self.E[f].mean(axis=0)
        Z1 = X @ self.W1 + self.b1
        H = np.maximum(Z1, 0)
        logits = H @ self.W2 + self.b2
        return X, Z1, H, logits

    def step(self, feats, y, lr=3e-3, wd=1e-5):
        X, Z1, H, logits = self.forward(feats)
        logits = logits - logits.max(axis=1, keepdims=True)
        P = np.exp(logits)
        P /= P.sum(axis=1, keepdims=True)
        B = len(y)
        loss = -np.log(P[np.arange(B), y] + 1e-9).mean()
        dL = P
        dL[np.arange(B), y] -= 1
        dL /= B
        g = {}
        g["W2"] = H.T @ dL + wd * self.W2
        g["b2"] = dL.sum(0)
        dH = dL @ self.W2.T
        dZ1 = dH * (Z1 > 0)
        g["W1"] = X.T @ dZ1 + wd * self.W1
        g["b1"] = dZ1.sum(0)
        dX = dZ1 @ self.W1.T
        gE = np.zeros_like(self.E)
        for i, f in enumerate(feats):
            np.add.at(gE, f, dX[i] / len(f))
        g["E"] = gE
        self.t += 1
        b1_, b2_ = 0.9, 0.999
        for p in self.params:
            self.m[p] = b1_ * self.m[p] + (1 - b1_) * g[p]
            self.v[p] = b2_ * self.v[p] + (1 - b2_) * g[p] ** 2
            mh = self.m[p] / (1 - b1_ ** self.t)
            vh = self.v[p] / (1 - b2_ ** self.t)
            setattr(self, p, getattr(self, p) - lr * mh / (np.sqrt(vh) + 1e-8))
        return loss

    def predict(self, feats):
        _, _, _, logits = self.forward(feats)
        return logits.argmax(1)


def quantize(a: np.ndarray) -> tuple[str, float]:
    scale = float(np.abs(a).max() / 127.0) or 1.0
    q = np.clip(np.round(a / scale), -127, 127).astype(np.int8)
    return base64.b64encode(q.tobytes()).decode("ascii"), scale


def main() -> None:
    lex = json.load(open(LEX_PATH))
    labels, data = build_dataset(lex)
    C = len(labels)
    n_val = 3000
    val, train = data[:n_val], data[n_val:]
    print(f"classes={C} train={len(train)} val={len(val)}")

    tr_f = [features(w) for w, _ in train]
    tr_y = np.array([y for _, y in train])
    va_f = [features(w) for w, _ in val]
    va_y = np.array([y for _, y in val])

    model = Model(C)
    bs = 256
    epochs = int(os.environ.get("EPOCHS", "18"))
    t0 = time.time()
    for ep in range(epochs):
        order = np.random.permutation(len(train))
        lr = 4e-3 * (0.82 ** ep)
        losses = []
        for s in range(0, len(order), bs):
            b = order[s : s + bs]
            losses.append(model.step([tr_f[i] for i in b], tr_y[b], lr=lr))
        acc = (model.predict(va_f) == va_y).mean()
        print(f"epoch {ep+1:2d}  loss={np.mean(losses):.4f}  val_acc={acc:.4f}  ({time.time()-t0:.0f}s)")

    # quantised accuracy check
    qE, sE = quantize(model.E)
    qW1, sW1 = quantize(model.W1)
    qW2, sW2 = quantize(model.W2)
    deq = lambda b, s, shape: np.frombuffer(base64.b64decode(b), np.int8).astype(np.float32).reshape(shape) * s
    model.E, model.W1, model.W2 = deq(qE, sE, (BUCKETS, EMB)), deq(qW1, sW1, (EMB, HID)), deq(qW2, sW2, (HID, C))
    qacc = (model.predict(va_f) == va_y).mean()
    print(f"int8 val_acc={qacc:.4f}")

    demo = ["thrusday", "fourty", "betwen", "nite", "wensday", "evrey", "fiveteen", "aftrenoon", "septmber", "backup", "fridge", "minuts", "weekedns", "tuseday", "databse", "mornign"]
    preds = model.predict([features(w) for w in demo])
    for w, p in zip(demo, preds):
        print(f"  {w:>10} -> {labels[p]}")

    b1 = ",".join(f"{x:.5f}" for x in model.b1)
    b2 = ",".join(f"{x:.5f}" for x in model.b2)
    params = BUCKETS * EMB + EMB * HID + HID + HID * C + C
    with open(OUT_PATH, "w") as f:
        f.write("// AUTO-GENERATED by training/train_model.py — do not edit by hand.\n")
        f.write(f"// Tiny on-device word-understanding model: {params} params, int8 quantised.\n")
        f.write(f"// Validation accuracy (fp32 / int8): see training log. int8 val_acc={qacc:.4f}\n")
        f.write("/* eslint-disable */\n")
        f.write("export const MODEL = {\n")
        f.write("  name: 'CronLex',\n")
        f.write(f"  version: '1.0.0',\n  buckets: {BUCKETS},\n  emb: {EMB},\n  hid: {HID},\n  minLen: {MIN_LEN},\n")
        f.write(f"  params: {params},\n  valAccuracy: {qacc:.4f},\n")
        f.write("  labels: " + json.dumps(labels) + ",\n")
        f.write(f"  E: {{ scale: {sE:.8g}, data: '{qE}' }},\n")
        f.write(f"  W1: {{ scale: {sW1:.8g}, data: '{qW1}' }},\n")
        f.write(f"  W2: {{ scale: {sW2:.8g}, data: '{qW2}' }},\n")
        f.write(f"  b1: [{b1}],\n  b2: [{b2}],\n")
        f.write("} as const;\n")
    print(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)/1024:.1f} KB, {params} params)")


if __name__ == "__main__":
    sys.exit(main())
