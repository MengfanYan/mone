// Resolve a local calendar-month boundary using the user's IANA time zone.
export function monthWindow(period, timezone = "Australia/Sydney") {
  const [year, month] = period.split("-").map(Number);
  const midnight = (y, m) => {
    const target = Date.UTC(y, m, 1),
      formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    let instant = target;
    for (let n = 0; n < 3; n++) {
      const p = Object.fromEntries(
        formatter
          .formatToParts(new Date(instant))
          .map((part) => [part.type, part.value]),
      );
      const represented = Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        Number(p.hour),
        Number(p.minute),
        Number(p.second),
      );
      instant += target - represented;
    }
    return instant;
  };
  return { start: midnight(year, month - 1), end: midnight(year, month) - 1 };
}
