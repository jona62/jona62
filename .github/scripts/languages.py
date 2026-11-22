#!/usr/bin/env python3
"""Draw languages.svg from the language bytes GitHub reports for my repositories.

Reads only GitHub's per-repo language totals (private repos included, with a token
that can see them) and writes percentages. No code or repo names leave the API.

Rules:
- My own repos plus the orgs in ORGS; forks, archived repos and SKIP are left out.
- Only repos pushed within WINDOW_YEARS count, so the card follows current work.
- Markup, config and data formats (NON_CODE) don't count as languages.
- Each repo's weight is capped at CAP_BYTES, so one huge repo (generated or
  experiment-heavy) can't drown out the rest.

Usage: GH_TOKEN=... python3 languages.py languages.svg
"""
import datetime as dt
import json
import os
import sys
import urllib.request
from collections import Counter

ORGS = ["rigbox-dev"]
SKIP = {"jona62/jona62", "rigbox-dev/codeindex", "rigbox-dev/list"}
WINDOW_YEARS = 3
CAP_BYTES = 2_000_000
TOP = 7
MIN_PCT = 2  # slivers under this are left off the card
NON_CODE = {
    "HTML", "CSS", "SCSS", "Sass", "Less", "MDX", "Markdown", "TeX", "Jupyter Notebook",
    "Makefile", "Dockerfile", "CMake", "Nix", "HCL", "Mako", "Procfile", "Batchfile",
    "PowerShell", "Smarty", "PLpgSQL", "TSQL", "Vue",
}
MERGE = {"JavaScript": "TypeScript/JavaScript", "TypeScript": "TypeScript/JavaScript"}
COLORS = {  # GitHub linguist colours
    "Rust": "#dea584", "TypeScript/JavaScript": "#3178c6", "Python": "#ffd43b",  # logo yellow; linguist blue blurs into TypeScript
    "C++": "#f34b7d", "C": "#555555", "Kotlin": "#a97bff", "Swift": "#f05138",
    "Shell": "#89e051", "Go": "#00add8", "Java": "#b07219", "Lua": "#000080",
}
TOKEN = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")


def get(url):
    out = []
    while url:
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req) as r:
            data = json.load(r)
            nxt = [p.split(";")[0].strip("<> ") for p in r.headers.get("Link", "").split(",")
                   if 'rel="next"' in p]
        if not isinstance(data, list):
            return data
        out += data
        url = nxt[0] if nxt else None
    return out


def shares():
    api = "https://api.github.com"
    repos = get(f"{api}/user/repos?affiliation=owner&per_page=100")
    for org in ORGS:
        repos += get(f"{api}/orgs/{org}/repos?type=all&per_page=100")
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=365 * WINDOW_YEARS)).isoformat()
    total = Counter()
    for r in {r["full_name"]: r for r in repos}.values():
        if r["fork"] or r["archived"] or r["full_name"] in SKIP or (r["pushed_at"] or "") < since:
            continue
        code = Counter()
        for lang, n in get(r["languages_url"]).items():
            if lang not in NON_CODE:
                code[MERGE.get(lang, lang)] += n
        size = sum(code.values())
        for lang, n in code.items():
            total[lang] += min(size, CAP_BYTES) * n / size
    s = sum(total.values())
    top = total.most_common(TOP)
    pct = [(k, round(100 * v / s)) for k, v in top]
    return [(k, p) for k, p in pct if p >= MIN_PCT]


def svg(items):
    font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
    w, x0, bar_w = 480, 8, 464
    total = sum(p for _, p in items)
    bars, x = [], x0
    for lang, p in items:
        bw = bar_w * p / total
        bars.append(f'<rect x="{x:.2f}" y="34" width="{bw:.2f}" height="8" fill="{COLORS.get(lang, "#8b949e")}"/>')
        x += bw
    legend, cx, cy = [], x0, 64
    for lang, p in items:
        label = f"{lang} {p}%"
        lw = 16 + len(label) * 7.2 + 18
        if cx + lw > w and cx > x0:
            cx, cy = x0, cy + 28
        legend.append(f'<circle cx="{cx + 5:.1f}" cy="{cy}" r="5" fill="{COLORS.get(lang, "#8b949e")}"/>'
                      f'<text x="{cx + 16:.1f}" y="{cy + 4}">{label}</text>')
        cx += lw
    h = cy + 20
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="Most used languages: {", ".join(f"{k} {p}%" for k, p in items)}">
  <style>.t{{fill:#0366d6}}.l{{fill:#57606a}}@media (prefers-color-scheme:dark){{.t{{fill:#58a6ff}}.l{{fill:#8b949e}}}}</style>
  <text class="t" x="8" y="22" font-size="16" font-family="{font}">Most used languages</text>
  <clipPath id="barclip"><rect x="{x0}" y="34" width="{bar_w}" height="8" rx="4"/></clipPath>
  <g clip-path="url(#barclip)">
    {chr(10).join("    " + b for b in bars).strip()}
  </g>
  <g class="l" font-size="13" font-family="{font}">
    {chr(10).join("    " + l for l in legend).strip()}
  </g>
</svg>
'''


if __name__ == "__main__":
    items = shares()
    print(", ".join(f"{k} {p}%" for k, p in items))
    with open(sys.argv[1] if len(sys.argv) > 1 else "languages.svg", "w") as f:
        f.write(svg(items))
