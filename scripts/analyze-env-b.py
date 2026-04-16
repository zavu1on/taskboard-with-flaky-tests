#!/usr/bin/env python3
"""
scripts/analyze-env-b.py
─────────────────────────────────────────────────────────────────────────────
Анализ результатов ORDER-DEPENDENT флакинесса (Среда B).

Анализирует три аспекта OD-тестов:
  1. Failure rate по OD-категориям (POLLUTER / VICTIM / BRITTLE / STABLE / ISOLATED)
  2. OD-паттерн: подтверждение зависимости VICTIM от порядка запуска
  3. Сравнение: isolated vs polluted vs stable (эффективность фиксов)

ЗАПУСК:
    python3 scripts/analyze-env-b.py

ЗАВИСИМОСТИ:
    pip install pandas matplotlib

ПРЕДВАРИТЕЛЬНЫЕ УСЛОВИЯ:
    Выполнить тесты среды B:

    # Шаг 1: isolated (victim без поллютера)
    TEST_ENV=B_od_isolated npx playwright test \\
        tests/e2e/10-od-listener-leak.spec.ts \\
        tests/e2e/11-od-localstorage.spec.ts \\
        --config playwright.env-b.config.ts \\
        --grep "ISOLATED" --repeat-each 15 --retries 0

    # Шаг 2: polluted (с поллютером)
    TEST_ENV=B_od_polluted npx playwright test \\
        tests/e2e/10-od-listener-leak.spec.ts \\
        tests/e2e/11-od-localstorage.spec.ts \\
        --config playwright.env-b.config.ts \\
        --grep "POLLUTER.VICTIM" --repeat-each 15 --retries 0

    # Шаг 3: stable (с фиксами)
    TEST_ENV=B_od_stable npx playwright test \\
        tests/e2e/10-od-listener-leak.spec.ts \\
        tests/e2e/11-od-localstorage.spec.ts \\
        --config playwright.env-b.config.ts \\
        --grep "STABLE" --repeat-each 15 --retries 0
"""

import json
import re
from pathlib import Path

import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import pandas as pd

# ── Конфиг ───────────────────────────────────────────────────────────────────

RESULTS_DIR = Path("stress-results")
OUTPUT_DIR  = Path("stress-results/analysis-b")

# Файлы результатов по режимам запуска
RESULT_FILES = {
    "isolated": RESULTS_DIR / "B_od_isolated.ndjson",
    "polluted":  RESULTS_DIR / "B_od_polluted.ndjson",
    "stable":    RESULTS_DIR / "B_od_stable.ndjson",
    # Полный прогон (если запускали без --grep)
    "full":      RESULTS_DIR / "B_od.ndjson",
}

# Цветовая схема для OD-категорий
OD_COLORS = {
    "POLLUTER": "#f97316",   # оранжевый — поллютер
    "VICTIM":   "#ef4444",   # красный — жертва
    "BRITTLE":  "#a855f7",   # фиолетовый — хрупкий
    "ISOLATED": "#3b82f6",   # синий — изолированный
    "STABLE":   "#22c55e",   # зелёный — стабильный
    "UNKNOWN":  "#64748b",   # серый — неизвестный
}

# Спеки с описаниями
SPEC_META = {
    "10-od-listener-leak": {
        "title":     "Spec 10: DOM Event Listener Leak",
        "mechanism": "Zombie capture-phase keydown listener\nблокирует TaskModal Escape handler",
        "od_type":   "VICTIM",
    },
    "11-od-localstorage": {
        "title":     "Spec 11: localStorage State Pollution",
        "mechanism": "click→saveLastColumn()→localStorage.setItem()\nVICTIM читает загрязнённый 'lastColumn'",
        "od_type":   "VICTIM",
    },
}

# ── Утилиты ───────────────────────────────────────────────────────────────────

def extract_od_category(title: str) -> str:
    """Определяет OD-категорию теста по его заголовку."""
    t = title.upper()
    if "[POLLUTER]" in t:   return "POLLUTER"
    if "[VICTIM]" in t:     return "VICTIM"
    if "[BRITTLE]" in t:    return "BRITTLE"
    if "[ISOLATED]" in t:   return "ISOLATED"
    if "[STABLE]" in t:     return "STABLE"
    # Попытка определить по контексту
    if "FLAKY" in t:        return "VICTIM"  # FLAKY = ожидаемый failure в OD контексте
    return "UNKNOWN"

def extract_spec(file_path: str) -> str:
    """Извлекает имя спека из пути к файлу."""
    base = Path(file_path).stem.replace(".spec", "")
    return base

def load_ndjson(path: Path) -> pd.DataFrame:
    """Загружает NDJSON файл в DataFrame."""
    if not path.exists():
        return pd.DataFrame()

    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    if not records:
        return pd.DataFrame()

    df = pd.DataFrame(records)
    df["failed"]      = df["status"].isin(["failed", "timedOut"])
    df["od_category"] = df["title"].apply(extract_od_category)
    if "spec" not in df.columns:
        df["spec"] = df["title"].apply(
            lambda t: extract_spec(t) if "file" not in df.columns else ""
        )
    return df

def load_all() -> dict[str, pd.DataFrame]:
    """Загружает все доступные файлы результатов."""
    result = {}
    for mode, path in RESULT_FILES.items():
        df = load_ndjson(path)
        if not df.empty:
            df["run_mode"] = mode
            result[mode] = df
            print(f"  Загружен '{mode}': {len(df)} записей из {path}")
        else:
            print(f"  Пропущен '{mode}': файл не найден ({path})")
    return result

# ── Графики ───────────────────────────────────────────────────────────────────

def plot_od_category_bars(dfs: dict[str, pd.DataFrame], out: Path) -> None:
    """
    Рис. 1. Failure Rate по OD-категориям.
    Показывает: VICTIM падает, POLLUTER/ISOLATED/STABLE проходят.
    """
    # Объединяем все доступные данные
    all_df = pd.concat(dfs.values(), ignore_index=True) if dfs else pd.DataFrame()

    if all_df.empty:
        print("  [skip] Нет данных для Рис. 1")
        return

    cats = ["ISOLATED", "POLLUTER", "VICTIM", "BRITTLE", "STABLE"]
    cats = [c for c in cats if c in all_df["od_category"].values]

    rates = []
    counts = []
    for cat in cats:
        sub = all_df[all_df["od_category"] == cat]
        rate = sub["failed"].mean() * 100 if not sub.empty else 0
        rates.append(rate)
        counts.append(len(sub))

    fig, ax = plt.subplots(figsize=(max(6, len(cats) * 1.4), 5))

    colors = [OD_COLORS.get(c, "#64748b") for c in cats]
    bars = ax.bar(cats, rates, color=colors, alpha=0.85,
                  edgecolor="white", linewidth=0.8)

    for bar, rate, n in zip(bars, rates, counts):
        if rate > 0:
            ax.text(bar.get_x() + bar.get_width() / 2,
                    rate + 1.5, f"{rate:.1f}%\n(n={n})",
                    ha="center", va="bottom", fontsize=9, fontweight="bold")
        else:
            ax.text(bar.get_x() + bar.get_width() / 2,
                    2, f"0%\n(n={n})",
                    ha="center", va="bottom", fontsize=9, color="#6b7280")

    ax.set_ylabel("Failure Rate (%)")
    ax.set_ylim(0, 115)
    ax.yaxis.set_major_formatter(mtick.PercentFormatter(xmax=100))
    ax.set_title(
        "Рис. 1. Среда B: Failure Rate по OD-категориям\n"
        "VICTIM падает из-за поллютера; STABLE и ISOLATED стабильны",
        pad=12
    )
    ax.grid(axis="y", alpha=0.3, linestyle="--")
    ax.spines[["top", "right"]].set_visible(False)

    # Легенда с пояснениями
    legend_patches = [
        mpatches.Patch(color=OD_COLORS["ISOLATED"], label="ISOLATED — victim в изоляции"),
        mpatches.Patch(color=OD_COLORS["POLLUTER"], label="POLLUTER — загрязняет среду"),
        mpatches.Patch(color=OD_COLORS["VICTIM"],   label="VICTIM — падает после polluter"),
        mpatches.Patch(color=OD_COLORS["BRITTLE"],  label="BRITTLE — требует polluter для прохождения"),
        mpatches.Patch(color=OD_COLORS["STABLE"],   label="STABLE — фикс применён"),
    ]
    ax.legend(handles=legend_patches, loc="upper right", fontsize=8)

    plt.tight_layout()
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Сохранён: {out}")


def plot_order_comparison(dfs: dict[str, pd.DataFrame], out: Path) -> None:
    """
    Рис. 2. Сравнение failure rate для VICTIM тестов в трёх режимах:
    - isolated (без поллютера): должен ~0%
    - polluted  (с поллютером): должен ~100%
    - stable    (с фиксом):     должен ~0%

    Наглядно демонстрирует ORDER-DEPENDENT паттерн.
    """
    modes = ["isolated", "polluted", "stable"]
    mode_labels = {
        "isolated": "Isolated\n(без поллютера)",
        "polluted":  "Polluted\n(с поллютером)",
        "stable":    "Stable\n(с cleanup)",
    }

    victim_rates = {}
    victim_ns = {}

    for mode in modes:
        if mode not in dfs:
            victim_rates[mode] = 0
            victim_ns[mode] = 0
            continue
        df = dfs[mode]
        victims = df[df["od_category"] == "VICTIM"]
        victim_rates[mode] = victims["failed"].mean() * 100 if not victims.empty else 0
        victim_ns[mode] = len(victims)

    x = range(len(modes))
    mode_colors = {
        "isolated": "#3b82f6",
        "polluted":  "#ef4444",
        "stable":    "#22c55e",
    }
    colors = [mode_colors[m] for m in modes]
    labels = [mode_labels[m] for m in modes]
    rates  = [victim_rates[m] for m in modes]
    ns     = [victim_ns[m] for m in modes]

    fig, ax = plt.subplots(figsize=(7, 5))
    bars = ax.bar(x, rates, color=colors, alpha=0.85,
                  edgecolor="white", linewidth=0.8, width=0.5)

    for bar, rate, n in zip(bars, rates, ns):
        y_pos = max(rate + 1.5, 4)
        ax.text(bar.get_x() + bar.get_width() / 2,
                y_pos, f"{rate:.1f}%\n(n={n})",
                ha="center", va="bottom", fontsize=10, fontweight="bold")

    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, fontsize=10)
    ax.set_ylabel("Failure Rate VICTIM-тестов (%)")
    ax.set_ylim(0, 120)
    ax.yaxis.set_major_formatter(mtick.PercentFormatter(xmax=100))
    ax.set_title(
        "Рис. 2. Среда B: OD-паттерн для VICTIM-тестов\n"
        "Order-Dependent: failure rate зависит от наличия поллютера",
        pad=12
    )
    ax.grid(axis="y", alpha=0.3, linestyle="--")
    ax.spines[["top", "right"]].set_visible(False)

    # Аннотация с пояснением
    ax.annotate(
        "Hallmark OD-флакинесса:\nVICTIM падает только при\nналичии POLLUTER",
        xy=(1, victim_rates.get("polluted", 80)),
        xytext=(1.5, 60),
        fontsize=8, color="#374151",
        arrowprops=dict(arrowstyle="->", color="#374151", lw=1),
    )

    plt.tight_layout()
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Сохранён: {out}")


def plot_spec_breakdown(dfs: dict[str, pd.DataFrame], out: Path) -> None:
    """
    Рис. 3. Детализация по спекам: failure rate VICTIM по spec 10 и spec 11.
    """
    all_df = pd.concat(dfs.values(), ignore_index=True) if dfs else pd.DataFrame()
    if all_df.empty:
        print("  [skip] Нет данных для Рис. 3")
        return

    victims = all_df[all_df["od_category"] == "VICTIM"]
    if victims.empty:
        print("  [skip] Нет VICTIM записей для Рис. 3")
        return

    spec_rates = (
        victims.groupby("spec")["failed"]
               .mean()
               .sort_values(ascending=False) * 100
    )

    fig, ax = plt.subplots(figsize=(max(5, len(spec_rates) * 1.8), 3))
    bars = ax.bar(
        range(len(spec_rates)),
        spec_rates.values,
        color="#ef4444", alpha=0.85,
        edgecolor="white",
    )

    # for bar, v, spec in zip(bars, spec_rates.values, spec_rates.index):
    #     meta = SPEC_META.get(spec, {})
    #     mechanism = meta.get("mechanism", "")
    #     ax.text(
    #         bar.get_x() + bar.get_width() / 2, v + 1.5,
    #         f"{v:.1f}%", ha="center", va="bottom",
    #         fontsize=10, fontweight="bold",
    #     )
    #     if mechanism:
    #         ax.text(
    #             bar.get_x() + bar.get_width() / 2, -12,
    #             mechanism,
    #             ha="center", va="top", fontsize=7,
    #             color="#374151", wrap=True,
    #         )

    spec_labels = [SPEC_META.get(s, {}).get("title", s) for s in spec_rates.index]
    ax.set_xticks(range(len(spec_rates)))
    ax.set_xticklabels(spec_labels, rotation=10, ha="right", fontsize=9)
    ax.set_ylabel("Failure Rate VICTIM (%)")
    ax.set_ylim(-25, 115)
    ax.yaxis.set_major_formatter(mtick.PercentFormatter(xmax=100))
    ax.set_title(
        "Рис. 3. Среда B: Failure Rate VICTIM-тестов по спекам\n"
        "с описанием механизма OD-флакинесса",
        pad=12
    )
    ax.grid(axis="y", alpha=0.3, linestyle="--")
    ax.spines[["top", "right"]].set_visible(False)

    plt.tight_layout()
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Сохранён: {out}")


# ── Текстовый отчёт ───────────────────────────────────────────────────────────

def text_report(dfs: dict[str, pd.DataFrame]) -> str:
    lines = [
        "=" * 62,
        "  ОТЧЁТ: Среда B — Order-Dependent (OD) тесты",
        "  Дата: " + pd.Timestamp.now().strftime("%Y-%m-%d %H:%M"),
        "=" * 62,
    ]

    all_df = pd.concat(dfs.values(), ignore_index=True) if dfs else pd.DataFrame()

    if all_df.empty:
        lines.append("\n[!] Нет данных. Запустите тесты среды B.")
        return "\n".join(lines)

    lines.append(f"\nВсего записей: {len(all_df)}")
    lines.append(f"Режимы запуска: {list(dfs.keys())}")

    # Статистика по OD-категориям
    lines.append("\n─── Failure Rate по OD-категориям ───")
    lines.append(f"  {'Категория':<12} {'Runs':>6} {'Fails':>6} {'Rate':>7}  Описание")
    lines.append("  " + "─" * 60)

    cat_descriptions = {
        "ISOLATED": "Victim без поллютера (baseline)",
        "POLLUTER": "Загрязняет среду для следующих тестов",
        "VICTIM":   "Падает из-за поллютера (OD-флакинесс)",
        "BRITTLE":  "Проходит только после поллютера",
        "STABLE":   "Фикс применён (cleanup в beforeEach)",
    }

    for cat in ["ISOLATED", "POLLUTER", "VICTIM", "BRITTLE", "STABLE"]:
        sub = all_df[all_df["od_category"] == cat]
        if sub.empty:
            continue
        n    = len(sub)
        fail = sub["failed"].sum()
        rate = sub["failed"].mean() * 100
        desc = cat_descriptions.get(cat, "")
        lines.append(f"  {cat:<12} {n:>6} {fail:>6} {rate:>6.1f}%  {desc}")

    # OD-паттерн: сравнение VICTIM в разных режимах
    lines.append("\n─── OD-паттерн: VICTIM failure rate по режимам ───")
    for mode in ["isolated", "polluted", "stable"]:
        if mode not in dfs:
            lines.append(f"  {mode:<10}  — данные отсутствуют")
            continue
        df = dfs[mode]
        victims = df[df["od_category"] == "VICTIM"]
        if victims.empty:
            lines.append(f"  {mode:<10}  — VICTIM-тестов нет")
        else:
            rate = victims["failed"].mean() * 100
            n = len(victims)
            flag = "← HALLMARK OD-ФЛАКИНЕССА" if mode == "polluted" and rate > 50 else ""
            lines.append(f"  {mode:<10}  rate={rate:5.1f}%  (n={n})  {flag}")

    # Подтверждение OD-гипотезы
    lines.append("\n─── Подтверждение OD-гипотезы ───")

    isolated_rate = 0.0
    polluted_rate = 0.0
    stable_rate   = 0.0

    if "isolated" in dfs:
        v = dfs["isolated"][dfs["isolated"]["od_category"] == "VICTIM"]
        if not v.empty:
            isolated_rate = v["failed"].mean() * 100

    if "polluted" in dfs:
        v = dfs["polluted"][dfs["polluted"]["od_category"] == "VICTIM"]
        if not v.empty:
            polluted_rate = v["failed"].mean() * 100

    if "stable" in dfs:
        v = dfs["stable"][dfs["stable"]["od_category"] == "STABLE"]
        if not v.empty:
            stable_rate = v["failed"].mean() * 100

    # H_OD1: Victim падает чаще при наличии поллютера
    h_od1 = polluted_rate > isolated_rate
    lines.append(
        f"\nH_OD1: VICTIM падает чаще при наличии POLLUTER\n"
        f"  isolated_rate={isolated_rate:.1f}% vs polluted_rate={polluted_rate:.1f}%\n"
        f"  Результат: {'ПОДТВЕРЖДЕНА ✓' if h_od1 else 'НЕ ПОДТВЕРЖДЕНА ✗'}"
    )

    # H_OD2: Фикс (cleanup) устраняет OD-флакинесс
    h_od2 = stable_rate < 5.0
    lines.append(
        f"\nH_OD2: Явная очистка состояния (beforeEach cleanup) устраняет OD-флакинесс\n"
        f"  stable_rate={stable_rate:.1f}% (порог: <5%)\n"
        f"  Результат: {'ПОДТВЕРЖДЕНА ✓' if h_od2 else 'НЕ ПОДТВЕРЖДЕНА ✗'}"
    )

    # Детализация по спекам
    lines.append("\n─── Детализация по спекам ───")
    for spec, meta in SPEC_META.items():
        sub = all_df[all_df["spec"].str.contains(spec.split("-")[0], na=False)]
        if sub.empty:
            lines.append(f"\n  {meta['title']}: нет данных")
            continue
        lines.append(f"\n  {meta['title']}")
        lines.append(f"    Механизм: {meta['mechanism'].replace(chr(10), ' ')}")
        for cat in ["POLLUTER", "VICTIM", "STABLE"]:
            cat_sub = sub[sub["od_category"] == cat]
            if cat_sub.empty:
                continue
            rate = cat_sub["failed"].mean() * 100
            lines.append(f"    {cat:<10} rate={rate:5.1f}%  n={len(cat_sub)}")

    lines.append("\n" + "=" * 62)
    return "\n".join(lines)

# ── Таблица результатов ───────────────────────────────────────────────────────

def failure_table(dfs: dict[str, pd.DataFrame]) -> pd.DataFrame:
    all_df = pd.concat(dfs.values(), ignore_index=True) if dfs else pd.DataFrame()
    if all_df.empty:
        return pd.DataFrame()

    tbl = (
        all_df.groupby(["spec", "od_category", "title", "run_mode"])
              .agg(runs=("failed", "count"), fails=("failed", "sum"))
              .reset_index()
    )
    tbl["rate_%"] = (tbl["fails"] / tbl["runs"] * 100).round(1)
    return tbl.sort_values(["spec", "od_category", "rate_%"],
                           ascending=[True, True, False])

# ── main ──────────────────────────────────────────────────────────────────────

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("\nЗагрузка результатов Среды B...")
    dfs = load_all()

    if not dfs:
        print("\n[!] Нет данных для анализа.")
        print("    Запустите тесты среды B (см. комментарий в файле).")
        return

    print("\nПостроение таблицы failure rate...")
    tbl = failure_table(dfs)
    if not tbl.empty:
        csv_path = OUTPUT_DIR / "failure_rate_env_b.csv"
        tbl.to_csv(csv_path, index=False)
        print(f"  CSV: {csv_path}")

    print("\nПостроение графиков...")
    plot_od_category_bars(dfs, OUTPUT_DIR / "figure_3_od_categories.png")
    plot_order_comparison(dfs, OUTPUT_DIR / "figure_4_order_comparison.png")
    plot_spec_breakdown(dfs,   OUTPUT_DIR / "figure_5_spec_breakdown.png")

    print("\nФормирование текстового отчёта...")
    report = text_report(dfs)
    report_path = OUTPUT_DIR / "report_env_b.txt"
    report_path.write_text(report, encoding="utf-8")
    print(f"  Отчёт: {report_path}")

    print(report)


if __name__ == "__main__":
    main()
