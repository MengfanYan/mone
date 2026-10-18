"use client";
import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale } from "./locale-provider";

const MONTH_NUMBERS = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
];

export default function MonthField({ value, onChange, label }) {
  const [prevValue, setPrevValue] = useState(value);
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const parsedYear = Number(String(draft || value).slice(0, 4)) || 2026;
  const [pickerYear, setPickerYear] = useState(() =>
    Math.min(2100, Math.max(1900, parsedYear)),
  );
  const containerRef = useRef(null);
  const { locale, dateLocale } = useLocale();

  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(value);
    const nextYear = Number(String(value).slice(0, 4));
    if (nextYear >= 1900 && nextYear <= 2100) {
      setPickerYear(nextYear);
    }
  }

  const valid = /^(19\d\d|20\d\d|2100)-(0[1-9]|1[0-2])$/.test(draft);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectMonth = (year, month) => {
    const next = `${year}-${month}`;
    setDraft(next);
    onChange(next);
    setOpen(false);
  };

  const openPicker = () => {
    const y = Number(String(draft || value).slice(0, 4));
    if (y >= 1900 && y <= 2100) {
      setPickerYear(y);
    }
    setOpen(true);
  };

  return (
    <div className="workspace-month-field" ref={containerRef}>
      <span className="sr-only">{label}</span>
      <div className="workspace-month-input-wrap">
        <input
          type="text"
          inputMode="numeric"
          className="workspace-month"
          aria-label={label}
          value={draft}
          placeholder="YYYY-MM"
          pattern="(19[0-9]{2}|20[0-9]{2}|2100)-(0[1-9]|1[0-2])"
          aria-invalid={!valid}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && !open) {
              e.preventDefault();
              openPicker();
            } else if (e.key === "Enter") {
              setOpen(false);
            }
          }}
          onChange={(e) => {
            const next = e.target.value.slice(0, 7);
            setDraft(next);
            if (/^(19\d\d|20\d\d|2100)-(0[1-9]|1[0-2])$/.test(next)) {
              setPickerYear(Number(next.slice(0, 4)));
              onChange(next);
            }
          }}
        />
        <button
          type="button"
          className="workspace-month-trigger"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => (open ? setOpen(false) : openPicker())}
        >
          <Calendar size={14} />
        </button>
      </div>
      {open && (
        <div
          className="month-picker-popover"
          role="dialog"
          aria-label={locale === "zh" ? "选择分析月份" : "Select month"}
        >
          <div className="month-picker-header">
            <button
              type="button"
              className="month-picker-nav"
              aria-label={locale === "zh" ? "上一年" : "Previous year"}
              disabled={pickerYear <= 1900}
              onClick={() => setPickerYear((y) => Math.max(1900, y - 1))}
            >
              <ChevronLeft size={15} />
            </button>
            <strong className="month-picker-year">
              {locale === "zh" ? `${pickerYear}年` : pickerYear}
            </strong>
            <button
              type="button"
              className="month-picker-nav"
              aria-label={locale === "zh" ? "下一年" : "Next year"}
              disabled={pickerYear >= 2100}
              onClick={() => setPickerYear((y) => Math.min(2100, y + 1))}
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="month-picker-grid">
            {MONTH_NUMBERS.map((mm, idx) => {
              const candidate = `${pickerYear}-${mm}`;
              const isSelected = draft === candidate;
              const monthLabel = new Intl.DateTimeFormat(dateLocale, {
                month: "short",
                timeZone: "UTC",
              }).format(new Date(Date.UTC(pickerYear, idx, 1, 12)));
              return (
                <button
                  key={mm}
                  type="button"
                  className={`month-picker-cell${isSelected ? " is-selected" : ""}`}
                  aria-pressed={isSelected}
                  onClick={() => selectMonth(pickerYear, mm)}
                >
                  {monthLabel}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <small>
        {valid
          ? new Intl.DateTimeFormat(dateLocale, {
              year: "numeric",
              month: "long",
              timeZone: "UTC",
            }).format(new Date(`${draft}-01T12:00:00Z`))
          : "YYYY-MM"}
      </small>
    </div>
  );
}
