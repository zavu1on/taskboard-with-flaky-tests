#!/usr/bin/env python3
"""
scripts/analyze-results.py
──────────────────────────────────────────────────────────────────────────────
Анализирует результаты стресс-тестирования из stress-results/*.ndjson.

ЗАВИСИМОСТИ:
    pip install pandas matplotlib seaborn scipy

ЗАПУСК:
    python3 scripts/analyze-results.py

    # Указать конкретную папку с результатами:
    python3 scripts/analyze-results.py --results-dir stress-results/

    # Только таблицы (без графиков):
    python3 scripts/analyze-results.py --no-plots

ВЫВОД:
    stress-results/analysis/failure_rate_table.csv   — основная таблица
    stress-results/analysis/category_breakdown.csv   — по категориям
    stress-results/analysis/figure_1_heatmap.png     — тепловая карта
    stress-results/analysis/figure_2_bars.png        — bar chart сред
    stress-results/analysis/figure_3_category.png    — breakdown по категориям
    stress-results/analysis/stats_report.txt         — статистика + выводы
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import pandas as pd
import seaborn as sns
from scipy import stats

# ── Константы ────────────────────────────────────────────────────────────────
ENV_ORDER = ["A_baseline", "B_cpu_throttle", "C_network_delay"]
ENV_LABELS = {
    "A_baseline": "A: Baseline",
    "B_cpu_throttle": "B: CPU 4x",
    "C_network_delay": "C: Net +300ms",
}
CATEGORY_ORDER = ["FLAKY", "STABLE", "STRESS", "UNKNOWN"]
CATEGORY_COLORS = {
    "FLAKY": "#ef4444",
    "STABLE": "#22c55e",
    "STRESS": "#f97316",
    "UNKNOWN": "#64748b",
}

# Spec-файлы и их категория по Pei et al.
SPEC_PEI_CATEGORY = {
    "01-async-race": "ED",
    "02-toast-timing": "R",
    "03-modal-dom-context": "DE",
    "04-optimistic-rollback": "R+ED",
    "05-drag-and-drop": "ED+E",
    "06-delete-dom-consistency": "D",
    "07-stress-concurrent": "ED (stress)",
    "08-stress-rapid-events": "R+DE (stress)",
    "09-stress-cascade-rollback": "D (stress)",
}


# ── Загрузка данных ───────────────────────────────────────────────────────────
def load_ndjson(path: Path) -> list[dict]:
    records = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError as e:
                    print(f"  [warn] Broken JSON in {path.name}: {e}")
    return records


def load_all_results(results_dir: Path) -> pd.DataFrame:
    all_records = []
    for ndjson_file in sorted(results_dir.glob("*.ndjson")):
        records = load_ndjson(ndjson_file)
        print(f"  Loaded {len(records):>5} records from {ndjson_file.name}")
        all_records.extend(records)

    if not all_records:
        print("ERROR: No NDJSON files found. Run ./scripts/run-experiments.sh first.")
        sys.exit(1)

    df = pd.DataFrame(all_records)

    # Добавляем Pei-категорию
    df["pei_category"] = df["spec"].map(SPEC_PEI_CATEGORY).fillna("?")

    # Булева колонка: тест упал?
    df["failed"] = df["status"].isin(["failed", "timedOut"])

    return df


# ── Основная таблица Failure Rate ─────────────────────────────────────────────
def compute_failure_rate_table(df: pd.DataFrame) -> pd.DataFrame:
    """
    Строит таблицу: строки = spec × category, столбцы = env.
    Значения = failure_rate (%).
    """
    grouped = (
        df.groupby(["spec", "category", "pei_category", "env"])
        .agg(total=("failed", "count"), failures=("failed", "sum"))
        .reset_index()
    )
    grouped["failure_rate"] = (grouped["failures"] / grouped["total"] * 100).round(1)

    pivot = grouped.pivot_table(
        index=["spec", "category", "pei_category"],
        columns="env",
        values="failure_rate",
        fill_value=0.0,
    ).reset_index()

    # Добавляем отсутствующие env как нули
    for env in ENV_ORDER:
        if env not in pivot.columns:
            pivot[env] = 0.0

    # Порядок колонок
    cols = ["spec", "category", "pei_category"] + [e for e in ENV_ORDER if e in pivot.columns]
    pivot = pivot[cols]

    return pivot


# ── Chi-square тест ────────────────────────────────────────────────────────────
def chi_square_flaky_vs_stable(df: pd.DataFrame) -> str:
    """
    Тест H3: Flaky-тесты значимо нестабильнее Stable?
    Используем chi-square на contingency table.
    """
    lines = ["\n=== Chi-Square Test: FLAKY vs STABLE ==="]

    for env in ENV_ORDER:
        env_df = df[df["env"] == env]

        flaky = env_df[env_df["category"] == "FLAKY"]
        stable = env_df[env_df["category"] == "STABLE"]

        if flaky.empty or stable.empty:
            lines.append(f"{env}: insufficient data")
            continue

        f_pass = (flaky["failed"] == False).sum()
        f_fail = (flaky["failed"] == True).sum()
        s_pass = (stable["failed"] == False).sum()
        s_fail = (stable["failed"] == True).sum()

        contingency = [[f_pass, f_fail], [s_pass, s_fail]]

        try:
            chi2, p, dof, _ = stats.chi2_contingency(contingency)
            sig = "✓ SIGNIFICANT" if p < 0.05 else "✗ not significant"
            lines.append(
                f"{ENV_LABELS.get(env, env):20s}  "
                f"χ²={chi2:6.2f}  p={p:.4f}  {sig}"
            )
        except ValueError as e:
            lines.append(f"{env}: chi2 error ({e})")

    return "\n".join(lines)


# ── Сравнение сред: H2 ────────────────────────────────────────────────────────
def compare_environments(df: pd.DataFrame) -> str:
    """
    Тест H2: Failure rate коррелирует с уровнем нагрузки?
    Сравниваем failure rate FLAKY тестов в A, B, C.
    """
    lines = ["\n=== Environment Comparison (FLAKY tests only) ==="]
    lines.append(f"{'Spec':<35} {'A%':>6} {'B%':>6} {'C%':>6} {'Max-A':>8}")

    flaky_df = df[df["category"] == "FLAKY"]

    for spec in sorted(flaky_df["spec"].unique()):
        spec_df = flaky_df[flaky_df["spec"] == spec]
        row = {}
        for env in ENV_ORDER:
            env_data = spec_df[spec_df["env"] == env]
            if env_data.empty:
                row[env] = None
            else:
                row[env] = round(env_data["failed"].mean() * 100, 1)

        a = row.get("A_baseline") or 0
        b = row.get("B_cpu_throttle") or 0
        c = row.get("C_network_delay") or 0
        max_delta = max(b - a, c - a, 0)

        lines.append(
            f"{spec:<35} {a:>5.1f}% {b:>5.1f}% {c:>5.1f}% {max_delta:>+7.1f}%"
        )

    return "\n".join(lines)


# ── Фигура 1: Тепловая карта failure rate ────────────────────────────────────
def plot_heatmap(pivot: pd.DataFrame, output_path: Path):
    # Только FLAKY и STRESS для наглядности
    data = pivot[pivot["category"].isin(["FLAKY", "STRESS"])].copy()

    if data.empty:
        print("  [warn] No FLAKY/STRESS data for heatmap")
        return

    # Строки: "spec (category)"
    data["label"] = data["spec"] + "\n[" + data["pei_category"] + "]"

    env_cols = [e for e in ENV_ORDER if e in data.columns]
    matrix = data.set_index("label")[env_cols]
    matrix.columns = [ENV_LABELS.get(c, c) for c in matrix.columns]

    fig, ax = plt.subplots(figsize=(10, max(4, len(matrix) * 0.6 + 2)))

    sns.heatmap(
        matrix,
        ax=ax,
        annot=True,
        fmt=".1f",
        cmap="RdYlGn_r",
        vmin=0,
        vmax=100,
        linewidths=0.5,
        cbar_kws={"label": "Failure Rate (%)", "shrink": 0.8},
    )

    ax.set_title("Рис. 1. Failure Rate (%) по тестам и средам\n(только FLAKY и STRESS)", pad=15)
    ax.set_xlabel("Среда тестирования")
    ax.set_ylabel("")
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Saved: {output_path}")


# ── Фигура 2: Bar chart — средний failure rate по средам ─────────────────────
def plot_env_bars(df: pd.DataFrame, output_path: Path):
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))

    for ax, category in zip(axes, ["FLAKY", "STABLE"]):
        cat_df = df[df["category"] == category]
        env_means = (
            cat_df.groupby("env")["failed"]
            .mean()
            .reindex(ENV_ORDER, fill_value=0) * 100
        )
        env_means.index = [ENV_LABELS.get(e, e) for e in env_means.index]

        bars = ax.bar(
            env_means.index,
            env_means.values,
            color=CATEGORY_COLORS[category],
            alpha=0.85,
            edgecolor="white",
            linewidth=0.5,
        )

        # Аннотации
        for bar, val in zip(bars, env_means.values):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height() + 0.5,
                f"{val:.1f}%",
                ha="center",
                va="bottom",
                fontsize=10,
                fontweight="bold",
            )

        ax.set_title(f"[{category}] тесты", fontsize=12, pad=10)
        ax.set_ylabel("Средний Failure Rate (%)")
        ax.set_ylim(0, 100)
        ax.yaxis.set_major_formatter(mtick.PercentFormatter(xmax=100))
        ax.grid(axis="y", alpha=0.3)
        ax.spines[["top", "right"]].set_visible(False)

    fig.suptitle(
        "Рис. 2. Средний Failure Rate: FLAKY vs STABLE по средам",
        fontsize=13,
        fontweight="bold",
        y=1.02,
    )
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Saved: {output_path}")


# ── Фигура 3: Breakdown по Pei-категориям ────────────────────────────────────
def plot_pei_category(df: pd.DataFrame, output_path: Path):
    flaky_df = df[df["category"] == "FLAKY"]
    if flaky_df.empty:
        print("  [warn] No FLAKY data for Pei category plot")
        return

    pei_env = (
        flaky_df.groupby(["pei_category", "env"])["failed"]
        .mean()
        .reset_index()
    )
    pei_env["failure_rate"] = pei_env["failed"] * 100
    pei_env["env_label"] = pei_env["env"].map(ENV_LABELS)

    pivot = pei_env.pivot(index="pei_category", columns="env_label", values="failure_rate").fillna(0)

    fig, ax = plt.subplots(figsize=(10, 5))
    pivot.plot(kind="bar", ax=ax, width=0.7, edgecolor="white")

    ax.set_title(
        "Рис. 3. Failure Rate FLAKY-тестов по категориям Pei et al. (ICST 2025)\nпо средам тестирования",
        pad=12,
    )
    ax.set_xlabel("Категория флакинесса (Pei et al.)")
    ax.set_ylabel("Failure Rate (%)")
    ax.set_xticklabels(ax.get_xticklabels(), rotation=30, ha="right")
    ax.yaxis.set_major_formatter(mtick.PercentFormatter(xmax=100))
    ax.set_ylim(0, 105)
    ax.legend(title="Среда")
    ax.grid(axis="y", alpha=0.3)
    ax.spines[["top", "right"]].set_visible(False)

    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Saved: {output_path}")


# ── Текстовый отчёт ───────────────────────────────────────────────────────────
def build_text_report(df: pd.DataFrame, pivot: pd.DataFrame) -> str:
    lines = [
        "=" * 60,
        "  ОТЧЁТ: Анализ флакинесса E2E тестов",
        f"  Сгенерировано: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}",
        "=" * 60,
    ]

    # Общая статистика
    total = len(df)
    by_env = df.groupby("env").agg(
        total=("failed", "count"),
        failures=("failed", "sum"),
    )
    by_env["rate"] = (by_env["failures"] / by_env["total"] * 100).round(1)

    lines.append("\n--- Общая статистика по средам ---")
    for env in ENV_ORDER:
        if env in by_env.index:
            row = by_env.loc[env]
            lines.append(
                f"  {ENV_LABELS.get(env, env):22s}  "
                f"total={int(row['total']):5d}  "
                f"failed={int(row['failures']):5d}  "
                f"rate={row['rate']:5.1f}%"
            )

    # Breakdown по категории
    lines.append("\n--- Breakdown: FLAKY vs STABLE ---")
    for cat in ["FLAKY", "STABLE"]:
        cat_df = df[df["category"] == cat]
        if cat_df.empty:
            continue
        lines.append(f"\n  [{cat}]")
        for env in ENV_ORDER:
            env_cat = cat_df[cat_df["env"] == env]
            if env_cat.empty:
                continue
            rate = env_cat["failed"].mean() * 100
            lines.append(f"    {ENV_LABELS.get(env, env):22s}  rate={rate:5.1f}%")

    # H1 проверка
    lines.append("\n--- Проверка Гипотезы H1 ---")
    lines.append("H1: FLAKY тесты падают с вероятностью > 0% при повторных запусках")
    flaky_df = df[df["category"] == "FLAKY"]
    any_failures = flaky_df["failed"].any()
    lines.append(f"  Результат: {'ПОДТВЕРЖДЕНА ✓' if any_failures else 'НЕ ПОДТВЕРЖДЕНА ✗'}")

    # H2 проверка
    lines.append("\n--- Проверка Гипотезы H2 ---")
    lines.append("H2: Failure rate FLAKY тестов коррелирует с уровнем нагрузки")
    lines.append(compare_environments(df))

    # H3 проверка
    lines.append("\n--- Проверка Гипотезы H3 ---")
    lines.append("H3: STABLE тесты статистически устойчивы (failure rate < 1%)")
    stable_df = df[df["category"] == "STABLE"]
    if not stable_df.empty:
        for env in ENV_ORDER:
            env_stable = stable_df[stable_df["env"] == env]
            if env_stable.empty:
                continue
            rate = env_stable["failed"].mean() * 100
            ok = rate < 1.0
            lines.append(
                f"  {ENV_LABELS.get(env, env):22s}  "
                f"rate={rate:5.2f}%  "
                f"{'✓ OK' if ok else '✗ UNSTABLE'}"
            )

    # Chi-square
    lines.append(chi_square_flaky_vs_stable(df))

    # Топ-5 нестабильных тестов
    lines.append("\n--- Топ-5 самых нестабильных тестов ---")
    top = (
        df[df["category"] == "FLAKY"]
        .groupby(["spec", "title"])["failed"]
        .mean()
        .sort_values(ascending=False)
        .head(5)
        * 100
    )
    for (spec, title), rate in top.items():
        lines.append(f"  {rate:5.1f}%  {spec}  {title[:50]}")

    lines.append("\n" + "=" * 60)
    return "\n".join(lines)


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Analyse flaky test results")
    parser.add_argument(
        "--results-dir",
        default="stress-results",
        help="Path to directory with *.ndjson files",
    )
    parser.add_argument(
        "--no-plots",
        action="store_true",
        help="Skip matplotlib plots (useful if display unavailable)",
    )
    args = parser.parse_args()

    results_dir = Path(args.results_dir)
    analysis_dir = results_dir / "analysis"
    analysis_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*50}")
    print(f"  Flaky Test Analysis")
    print(f"  Results dir: {results_dir}")
    print(f"{'='*50}\n")

    # Загрузка
    print("Loading data...")
    df = load_all_results(results_dir)
    print(f"Total records: {len(df)}\n")

    # Основная таблица
    print("Computing failure rate table...")
    pivot = compute_failure_rate_table(df)
    csv_path = analysis_dir / "failure_rate_table.csv"
    pivot.to_csv(csv_path, index=False)
    print(f"  Saved: {csv_path}")

    # Category breakdown
    cat_path = analysis_dir / "category_breakdown.csv"
    cat_breakdown = (
        df.groupby(["env", "category", "pei_category"])
        .agg(total=("failed", "count"), failures=("failed", "sum"))
        .assign(failure_rate=lambda x: (x["failures"] / x["total"] * 100).round(1))
        .reset_index()
    )
    cat_breakdown.to_csv(cat_path, index=False)
    print(f"  Saved: {cat_path}")

    # Текстовый отчёт
    report = build_text_report(df, pivot)
    report_path = analysis_dir / "stats_report.txt"
    with open(report_path, "w") as f:
        f.write(report)
    print(f"  Saved: {report_path}")
    print("\n" + report)

    # Графики
    if not args.no_plots:
        print("\nGenerating plots...")
        try:
            plot_heatmap(pivot, analysis_dir / "figure_1_heatmap.png")
            plot_env_bars(df, analysis_dir / "figure_2_bars.png")
            plot_pei_category(df, analysis_dir / "figure_3_category.png")
        except Exception as e:
            print(f"  [warn] Plot error: {e}")
            print("  Run with --no-plots if display unavailable")

    print(f"\n{'='*50}")
    print(f"  Analysis complete -> {analysis_dir}/")
    print(f"{'='*50}\n")


if __name__ == "__main__":
    main()
