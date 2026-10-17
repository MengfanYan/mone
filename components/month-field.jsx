"use client";
import { useState } from "react";
import { useLocale } from "./locale-provider";
export default function MonthField({ value, onChange, label }) {
  const [draft, setDraft] = useState(value),
    { locale, dateLocale } = useLocale();
  const valid = /^(19\d\d|20\d\d|2100)-(0[1-9]|1[0-2])$/.test(draft);
  return (
    <label className="workspace-month-field">
      <span className="sr-only">{label}</span>
      <input
        className="workspace-month"
        aria-label={label}
        lang={locale}
        inputMode="numeric"
        value={draft}
        maxLength={7}
        pattern="(19[0-9]{2}|20[0-9]{2}|2100)-(0[1-9]|1[0-2])"
        aria-invalid={!valid}
        onChange={(e) => {
          setDraft(e.target.value);
          if (/^(19\d\d|20\d\d|2100)-(0[1-9]|1[0-2])$/.test(e.target.value))
            onChange(e.target.value);
        }}
      />
      <small>
        {valid
          ? new Intl.DateTimeFormat(dateLocale, {
              year: "numeric",
              month: "long",
              timeZone: "UTC",
            }).format(new Date(`${draft}-01T12:00:00Z`))
          : "YYYY-MM"}
      </small>
    </label>
  );
}
