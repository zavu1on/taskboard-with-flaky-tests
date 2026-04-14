#!/usr/bin/env python3
"""
scripts/analyze-env-a.py
────────────────────────
Быстрый анализ результатов Среды A (baseline).
Исключает нерабочий тест pipeline Backlog->Done из всей аналитики.

ЗАПУСК:
    python3 scripts/analyze-env-a.py

ЗАВИСИМОСТИ:
    pip install pandas matplotlib
"""

import json
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import pandas as pd

# ── Конфиг ───────────────────────────────────────────────────────────────────

RESULTS_FILE = Path("stress-results/A_baseline.ndjson")
OUTPUT_DIR   = Path("stress-results/analysis-a")

# Тест исключён: нерабочая реализация pipeline, не относится к флакинессу
EXCLUDED_TESTS = {
    "[STABLE] задача проходит весь pipeline Backlog->Done",
}

CATEGORY_COLORS = {
    "FLAKY":   "#ef4444",
    "STABLE":  "#22c55e",
    "STRESS":  "#f97316",
    "UNKNOWN": "#64748b",
}

SPEC_PEI = {
    "01-async-race":              "ED",
    "02-toast-timing":            "R",
    "03-modal-dom-context":       "DE",
    "04-optimistic-rollback":     "R+ED",
    "05-drag-and-drop":           "ED+E",
    "06-delete-dom-consistency":  "D",
    "07-stress-concurrent":       "ED (stress)",
    "08-stress-rapid-events":     "R+DE (stress)",
    "09-stress-cascade-rollback": "D (stress)",
}

# ── Загрузка ─────────────────────────────────────────────────────────────────

def load(path: Path) -> pd.DataFrame:
    records = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    df = pd.DataFrame(records)
    df["failed"] = df["status"].isin(["failed", "timedOut"])
    df["pei"]    = df["spec"].map(SPEC_PEI).fillna("?")
    return df

# ── Фильтрация ───────────────────────────────────────────────────────────────

def filter_df(df: pd.DataFrame) -> pd.DataFrame:
    before = len(df)
    df = df[~df["title"].isin(EXCLUDED_TESTS)].copy()
    after  = len(df)
    print(f"  Исключено записей: {before - after}  ({before} → {after})")
    return df

# ── Таблица failure rate ──────────────────────────────────────────────────────

def failure_table(df: pd.DataFrame) -> pd.DataFrame:
    tbl = (
        df.groupby(["spec", "pei", "category", "title"])
          .agg(runs=("failed", "count"), fails=("failed", "sum"))
          .reset_index()
    )
    tbl["rate_%"] = (tbl["fails"] / tbl["runs"] * 100).round(1)
    return tbl.sort_values(["spec", "category", "rate_%"], ascending=[True, True, False])

# ── График 1: Failure rate по спекам (FLAKY vs STABLE) ───────────────────────

def plot_spec_bars(df: pd.DataFrame, out: Path):
    summary = (
        df[df["category"].isin(["FLAKY", "STABLE"])]
          .groupby(["spec", "category"])["failed"]
          .mean()
          .reset_index()
    )
    summary["rate"] = summary["failed"] * 100

    specs = sorted(summary["spec"].unique())
    x     = range(len(specs))
    width = 0.35

    fig, ax = plt.subplots(figsize=(max(8, len(specs) * 1.4), 5))

    for i, cat in enumerate(["FLAKY", "STABLE"]):
        vals = [
            summary.loc[(summary["spec"] == s) & (summary["category"] == cat), "rate"]
                   .values[0]
            if len(summary.loc[(summary["spec"] == s) & (summary["category"] == cat)]) else 0
            for s in specs
        ]
        bars = ax.bar(
            [xi + i * width for xi in x],
            vals,
            width,
            label=cat,
            color=CATEGORY_COLORS[cat],
            alpha=0.85,
            edgecolor="white",
        )
        for bar, v in zip(bars, vals):
            if v > 0:
                ax.text(bar.get_x() + bar.get_width() / 2, v + 0.8,
                        f"{v:.0f}%", ha="center", va="bottom", fontsize=8)

    ax.set_xticks([xi + width / 2 for xi in x])
    ax.set_xticklabels(specs, rotation=30, ha="right", fontsize=9)
    ax.set_ylabel("Failure Rate (%)")
    ax.set_ylim(0, 110)
    ax.yaxis.set_major_formatter(mtick.PercentFormatter(xmax=100))
    ax.legend(title="Категория")
    ax.set_title("Рис. 1. Среда A (Baseline): Failure Rate по спекам\nFLAKY vs STABLE", pad=12)
    ax.grid(axis="y", alpha=0.3)
    ax.spines[["top", "right"]].set_visible(False)

    plt.tight_layout()
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Сохранён: {out}")

# ── График 2: Failure rate по Pei-категориям ─────────────────────────────────

def plot_pei_bars(df: pd.DataFrame, out: Path):
    flaky = df[df["category"] == "FLAKY"]
    if flaky.empty:
        print("  [skip] Нет FLAKY-данных для Pei-графика")
        return

    pei_rate = (
        flaky.groupby("pei")["failed"]
             .mean()
             .sort_values(ascending=False) * 100
    )

    fig, ax = plt.subplots(figsize=(max(6, len(pei_rate) * 1.2), 4))
    bars = ax.bar(
        pei_rate.index, pei_rate.values,
        color="#ef4444", alpha=0.85, edgecolor="white",
    )
    for bar, v in zip(bars, pei_rate.values):
        ax.text(bar.get_x() + bar.get_width() / 2, v + 0.8,
                f"{v:.1f}%", ha="center", va="bottom", fontsize=9, fontweight="bold")

    ax.set_ylabel("Failure Rate (%)")
    ax.set_ylim(0, 110)
    ax.yaxis.set_major_formatter(mtick.PercentFormatter(xmax=100))
    ax.set_title("Рис. 2. Среда A: Failure Rate FLAKY-тестов\nпо категориям Pei et al. (ICST 2025)", pad=12)
    ax.grid(axis="y", alpha=0.3)
    ax.spines[["top", "right"]].set_visible(False)

    plt.tight_layout()
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Сохранён: {out}")

# ── Текстовый отчёт ───────────────────────────────────────────────────────────

def text_report(df: pd.DataFrame, tbl: pd.DataFrame) -> str:
    lines = [
        "=" * 58,
        "  ОТЧЁТ: Среда A — Baseline",
        f"  Всего записей: {len(df)}",
        f"  Исключён тест: {list(EXCLUDED_TESTS)}",
        "=" * 58,
    ]

    # Общий failure rate по категориям
    lines.append("\n--- Failure Rate по категориям ---")
    for cat in ["FLAKY", "STABLE", "STRESS"]:
        sub = df[df["category"] == cat]
        if sub.empty:
            continue
        rate = sub["failed"].mean() * 100
        lines.append(f"  {cat:<8}  runs={len(sub):4d}  rate={rate:5.1f}%")

    # Детализация по тестам
    lines.append("\n--- Детализация FLAKY-тестов ---")
    lines.append(f"  {'Spec':<35} {'Runs':>5} {'Fails':>6} {'Rate':>6}")
    lines.append("  " + "-" * 56)
    flaky_tbl = tbl[tbl["category"] == "FLAKY"].sort_values("rate_%", ascending=False)
    for _, row in flaky_tbl.iterrows():
        lines.append(
            f"  {row['spec']:<35} {int(row['runs']):>5} "
            f"{int(row['fails']):>6} {row['rate_%']:>5.1f}%"
        )

    lines.append("\n--- Детализация STABLE-тестов ---")
    lines.append(f"  {'Spec':<35} {'Runs':>5} {'Fails':>6} {'Rate':>6}")
    lines.append("  " + "-" * 56)
    stable_tbl = tbl[tbl["category"] == "STABLE"].sort_values("rate_%", ascending=False)
    for _, row in stable_tbl.iterrows():
        lines.append(
            f"  {row['spec']:<35} {int(row['runs']):>5} "
            f"{int(row['fails']):>6} {row['rate_%']:>5.1f}%"
        )

    # Проверка H1
    lines.append("\n--- Проверка H1 ---")
    lines.append("H1: FLAKY тесты падают с вероятностью > 0%")
    flaky_df  = df[df["category"] == "FLAKY"]
    any_fails = flaky_df["failed"].any() if not flaky_df.empty else False
    lines.append(f"  Результат: {'ПОДТВЕРЖДЕНА ✓' if any_fails else 'НЕ ПОДТВЕРЖДЕНА ✗'}")

    # Проверка H3
    lines.append("\n--- Проверка H3 ---")
    lines.append("H3: STABLE тесты имеют failure rate < 1%")
    stable_df = df[df["category"] == "STABLE"]
    if not stable_df.empty:
        rate = stable_df["failed"].mean() * 100
        ok   = rate < 1.0
        lines.append(f"  Среда A: rate={rate:.2f}%  {'✓ OK' if ok else '✗ НЕСТАБИЛЬНО'}")

    lines.append("\n" + "=" * 58)
    return "\n".join(lines)

# ── main ──────────────────────────────────────────────────────────────────────

def main():
    if not RESULTS_FILE.exists():
        print(f"ERROR: файл не найден: {RESULTS_FILE}")
        print("Запусти сначала тесты среды A.")
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\nЗагрузка: {RESULTS_FILE}")
    df  = load(RESULTS_FILE)
    print(f"Загружено записей: {len(df)}")

    print("\nФильтрация исключённых тестов...")
    df  = filter_df(df)

    print("\nПодсчёт статистики...")
    tbl = failure_table(df)
    tbl.to_csv(OUTPUT_DIR / "failure_rate_env_a.csv", index=False)
    print(f"  CSV: {OUTPUT_DIR / 'failure_rate_env_a.csv'}")

    print("\nГрафики...")
    plot_spec_bars(df, OUTPUT_DIR / "figure_1_spec_bars.png")
    plot_pei_bars(df,  OUTPUT_DIR / "figure_2_pei_bars.png")

    report = text_report(df, tbl)
    rpath  = OUTPUT_DIR / "report_env_a.txt"
    rpath.write_text(report, encoding="utf-8")
    print(f"  Текстовый отчёт: {rpath}")

    print(report)

if __name__ == "__main__":
    main()
