import { formatTRY, MENU_GROUP_LABELS, pctChange, type ScheduleGroup } from "@lodos/shared";
import { BAND, BOLD, finish, hoursLabel, INK, LINE, MUTED, newDoc, REGULAR, type PdfLang } from "../shifts/pdf";
import type { MonthlyView, Pair } from "./monthly";

/**
 * The monthly business PDF (spec §8, §13.9): A4 portrait, the page's sections as tables, with simple horizontal bar
 * charts drawn as rectangles next to their numbers (each bar has its figure printed, so the text carries everything).
 */

export type MonthlyPdfData = { restaurant: string; view: MonthlyView };

const BAR = "#0f766e";
const OVER = "#b45309";

const T = {
  en: {
    title: "Monthly report", soFar: "so far", vs: "Compared with",
    pnl: "Profit and loss", sales: "Sales", foodDrink: "Food and drink cost", labour: "Labour", other: "Other costs", profit: "Profit", margin: "Margin",
    thisMonth: "This month", previous: "Previous", change: "Change", ofSales: "% of sales",
    patterns: "Sales patterns", avgCheck: "Average check", avgCover: "Per cover", covers: "Covers", perLabourHour: "Sales per labour hour", turns: "Table turns per night",
    byDay: "Sales by day", byWeekday: "Sales by weekday (per open night)", byHour: "Sales by hour (per open night)",
    menu: "Menu: popularity × rating", dish: "Dish", group: "Group", qty: "Qty", revenue: "Revenue", rating: "Rating", ratings: "Ratings",
    staff: "Staff", name: "Name", role: "Role", hours: "Hours (planned)", late: "Late", points: "Points", labourCost: "Labour cost",
    labourByGroup: "Labour cost by group", overtime: "Overtime",
    guests: "Guests and ratings", restaurant: "Restaurant rating", food: "Food", cleanliness: "Cleanliness", atmosphere: "Atmosphere",
    spread: "Rating spread", waiters: "Waiters", dishes: "Dishes", byWeek: "By week", week: "Week of", comments: "Latest comments",
    expenses: "Expenses", category: "Category", spent: "Spent", budget: "Budget", biggest: "Biggest expenses", date: "Date", payee: "Payee", amount: "Amount",
    none: "Not enough data yet",
    roles: { waiter: "Waiter", cook: "Cook", bartender: "Bartender" } as Record<string, string>,
    groups: { floor: "Floor", kitchen: "Kitchen", bar: "Bar", managers: "Managers" } as Record<ScheduleGroup, string>,
  },
  tr: {
    title: "Aylık rapor", soFar: "şu ana kadar", vs: "Karşılaştırma:",
    pnl: "Kâr ve zarar", sales: "Satışlar", foodDrink: "Yiyecek ve içecek maliyeti", labour: "İşçilik", other: "Diğer giderler", profit: "Kâr", margin: "Marj",
    thisMonth: "Bu ay", previous: "Önceki", change: "Değişim", ofSales: "Satışa oranı",
    patterns: "Satış örüntüleri", avgCheck: "Ortalama hesap", avgCover: "Kişi başı", covers: "Kişi sayısı", perLabourHour: "İşçilik saati başına satış", turns: "Gece başına masa devri",
    byDay: "Günlere göre satış", byWeekday: "Haftanın günlerine göre satış (açık gece başına)", byHour: "Saatlere göre satış (açık gece başına)",
    menu: "Menü: popülerlik × puan", dish: "Ürün", group: "Grup", qty: "Adet", revenue: "Ciro", rating: "Puan", ratings: "Puan sayısı",
    staff: "Personel", name: "Ad", role: "Rol", hours: "Saat (plan)", late: "Geç", points: "Skor", labourCost: "İşçilik maliyeti",
    labourByGroup: "Gruba göre işçilik maliyeti", overtime: "Fazla mesai",
    guests: "Misafirler ve puanlar", restaurant: "Restoran puanı", food: "Yemek", cleanliness: "Temizlik", atmosphere: "Atmosfer",
    spread: "Puan dağılımı", waiters: "Garsonlar", dishes: "Ürünler", byWeek: "Haftalara göre", week: "Hafta", comments: "Son yorumlar",
    expenses: "Giderler", category: "Kategori", spent: "Harcanan", budget: "Bütçe", biggest: "En büyük giderler", date: "Tarih", payee: "Alıcı", amount: "Tutar",
    none: "Henüz yeterli veri yok",
    roles: { waiter: "Garson", cook: "Aşçı", bartender: "Barmen" } as Record<string, string>,
    groups: { floor: "Servis", kitchen: "Mutfak", bar: "Bar", managers: "Yöneticiler" } as Record<ScheduleGroup, string>,
  },
} as const;

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const intl = (lang: PdfLang) => (lang === "tr" ? "tr-TR" : "en-US");
const monthTitle = (month: string, lang: PdfLang) =>
  new Intl.DateTimeFormat(intl(lang), { month: "long", year: "numeric", timeZone: "UTC" }).format(utc(`${month}-01`));
const shortDate = (day: string, lang: PdfLang) => new Intl.DateTimeFormat(intl(lang), { day: "numeric", month: "short", timeZone: "UTC" }).format(utc(day));
const weekdayName = (iso: number, lang: PdfLang) =>
  new Intl.DateTimeFormat(intl(lang), { weekday: "long", timeZone: "UTC" }).format(utc(`2026-11-0${(iso % 7) + 1}`)); // 2026-11-02 is a Monday

const dec = (n: number, digits: number, lang: PdfLang) => {
  const s = n.toFixed(digits);
  return lang === "tr" ? s.replace(".", ",") : s;
};
const pct = (n: number | null, lang: PdfLang) => (n === null ? "—" : lang === "tr" ? `%${dec(n, 1, lang)}` : `${dec(n, 1, lang)}%`);
const signedPct = (n: number | null, lang: PdfLang) => (n === null ? "—" : `${n > 0 ? "+" : ""}${pct(n, lang)}`);
const money = (n: number | null, lang: PdfLang) => (n === null ? "—" : formatTRY(n, lang));
const stars = (n: number | null, lang: PdfLang) => (n === null ? "—" : dec(n, 1, lang));

type Col = { label: string; w: number; right?: boolean };

export async function monthlyPdf(data: MonthlyPdfData, lang: PdfLang): Promise<Buffer> {
  const { view } = data;
  const t = T[lang];
  const doc = newDoc({ layout: "portrait" });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const top = doc.page.margins.top;
  const bottom = doc.page.height - doc.page.margins.bottom;
  let y = top;

  const room = (h: number) => {
    if (y + h <= bottom) return;
    doc.addPage();
    y = top;
  };
  const heading = (text: string) => {
    room(60);
    y += 14;
    doc.font(BOLD).fontSize(13).fillColor(INK).text(text, left, y, { width });
    y = doc.y + 6;
  };
  const sub = (text: string) => {
    room(60); // the subheading never ends a page alone: a table header and a row fit under it
    y += 6;
    doc.font(BOLD).fontSize(10).fillColor(INK).text(text, left, y, { width });
    y = doc.y + 4;
  };
  const note = (text: string) => {
    room(16);
    doc.font(REGULAR).fontSize(9).fillColor(MUTED).text(text, left, y, { width });
    y = doc.y + 4;
  };

  const ROW = 15;
  const cells = (cols: Col[], values: string[], font: string) => {
    let x = left;
    cols.forEach((c, i) => {
      doc.font(font).fontSize(8.5).fillColor(INK).text(values[i] ?? "", x + 4, y + 4, { width: c.w - 8, align: c.right ? "right" : "left", lineBreak: false, ellipsis: true });
      x += c.w;
    });
  };
  const table = (cols: Col[], rows: string[][]) => {
    const head = () => {
      doc.rect(left, y, width, ROW).fill(BAND);
      cells(cols, cols.map((c) => c.label), BOLD);
      y += ROW;
    };
    room(ROW * 2);
    head();
    for (const r of rows) {
      if (y + ROW > bottom) {
        doc.addPage();
        y = top;
        head();
      }
      cells(cols, r, REGULAR);
      doc.moveTo(left, y + ROW).lineTo(left + width, y + ROW).lineWidth(0.5).strokeColor(LINE).stroke();
      y += ROW;
    }
    y += 4;
  };
  /** Horizontal bars: a label, a bar scaled to the largest value, and the figure printed after it. */
  const bars = (rows: { label: string; value: number; text: string; color?: string }[], labelW = 110) => {
    const max = Math.max(0, ...rows.map((r) => r.value));
    const textW = 90;
    const barW = width - labelW - textW;
    const H = 12;
    for (const r of rows) {
      room(H + 2);
      doc.font(REGULAR).fontSize(8).fillColor(INK).text(r.label, left, y + 2, { width: labelW - 6, lineBreak: false, ellipsis: true });
      const w = max > 0 ? Math.max(0, (r.value / max) * barW) : 0;
      if (w > 0) doc.rect(left + labelW, y + 2, w, H - 3).fill(r.color ?? BAR);
      doc.font(REGULAR).fontSize(8).fillColor(INK).text(r.text, left + labelW + w + 4, y + 2, { width: textW, lineBreak: false });
      y += H + 2;
    }
    y += 4;
  };
  const vsCols = (first: string, firstW = 190): Col[] => {
    const rest = (width - firstW) / 4;
    return [{ label: first, w: firstW }, { label: t.thisMonth, w: rest, right: true }, { label: t.previous, w: rest, right: true }, { label: t.change, w: rest, right: true }, { label: t.ofSales, w: rest, right: true }];
  };
  const moneyRow = (label: string, p: Pair<number>, share = true) => [
    label, money(p.cur, lang), money(p.prev, lang), signedPct(pctChange(p.cur, p.prev), lang),
    share && view.pnl.cur.sales > 0 ? pct(Math.round((p.cur / view.pnl.cur.sales) * 1000) / 10, lang) : "",
  ];

  // Title.
  const title = `${monthTitle(view.month, lang)}${view.soFar ? ` (${t.soFar})` : ""}`;
  doc.font(BOLD).fontSize(18).fillColor(INK).text(`${data.restaurant} · ${t.title}`, left, y, { width });
  doc.font(BOLD).fontSize(14).text(title, left, doc.y + 2, { width });
  const range = (from: string | null, to: string | null) => (from && to ? `${shortDate(from, lang)} – ${shortDate(to, lang)} ${to.slice(0, 4)}` : "—");
  doc.font(REGULAR).fontSize(9).fillColor(MUTED).text(`${range(view.current.from, view.current.to)} · ${t.vs} ${range(view.previous.from, view.previous.to)}`, left, doc.y + 2, { width });
  y = doc.y + 4;

  // 1. Profit and loss.
  const pnl = view.pnl;
  const pick = (k: "sales" | "foodDrink" | "labour" | "other" | "profit") => ({ cur: pnl.cur[k], prev: pnl.prev[k] });
  heading(t.pnl);
  const prevOther = new Map(pnl.prev.otherByCategory.map((c) => [c.categoryId, c.spent]));
  table(vsCols(""), [
    moneyRow(t.sales, pick("sales"), false),
    moneyRow(t.foodDrink, pick("foodDrink")),
    moneyRow(t.labour, pick("labour")),
    moneyRow(t.other, pick("other")),
    ...pnl.cur.otherByCategory.map((c) => moneyRow(`   ${c.name[lang]}`, { cur: c.spent, prev: prevOther.get(c.categoryId) ?? 0 })),
  ]);
  // The profit gets its own line, so its figure is one text run.
  room(40);
  doc.font(BOLD).fontSize(11).fillColor(INK).text(`${t.profit}:`, left, y, { continued: false, width: 120 });
  doc.text(money(pnl.cur.profit, lang), left + 120, y, { width: 160, lineBreak: false });
  doc.font(REGULAR).fontSize(9).fillColor(MUTED).text(`${t.previous}: ${money(pnl.prev.profit, lang)}`, left + 290, y + 2, { width: width - 290, lineBreak: false });
  y += 16;
  const marginPct = (m: number | null) => (m === null ? null : Math.round(m * 1000) / 10);
  doc.font(BOLD).fontSize(11).fillColor(INK).text(`${t.margin}:`, left, y, { width: 120 });
  doc.text(pct(marginPct(pnl.cur.margin), lang), left + 120, y, { width: 160, lineBreak: false });
  doc.font(REGULAR).fontSize(9).fillColor(MUTED).text(`${t.previous}: ${pct(marginPct(pnl.prev.margin), lang)}`, left + 290, y + 2, { width: width - 290, lineBreak: false });
  y += 20;

  // 2. Sales patterns.
  const s = view.sales;
  heading(t.patterns);
  const kpi = (label: string, p: Pair<number | null>, fmt: (n: number | null) => string) => [
    label, fmt(p.cur), fmt(p.prev), p.cur === null || p.prev === null ? "—" : signedPct(pctChange(p.cur, p.prev), lang),
  ];
  const kpiCols = vsCols("").slice(0, 4);
  table(kpiCols, [
    kpi(t.avgCheck, s.avgCheck, (n) => money(n, lang)),
    kpi(t.avgCover, s.avgCover, (n) => money(n, lang)),
    kpi(t.covers, s.covers, (n) => (n === null ? "—" : String(n))),
    kpi(t.perLabourHour, s.salesPerLabourHour, (n) => money(n, lang)),
    kpi(t.turns, s.turnsPerNight, (n) => (n === null ? "—" : dec(n, 2, lang))),
  ]);
  sub(t.byWeekday);
  bars(s.byWeekday.cur.map((d) => ({ label: weekdayName(d.weekday, lang), value: d.avg, text: money(d.avg, lang) })));
  sub(t.byHour);
  if (s.byHour.cur.length === 0) note(t.none);
  bars(s.byHour.cur.map((h) => ({ label: `${String(h.hour).padStart(2, "0")}:00`, value: h.revenue, text: money(h.revenue, lang) })), 60);
  sub(t.byDay);
  bars(s.byDay.cur.map((d) => ({ label: `${shortDate(d.day, lang)} · ${weekdayName(((utc(d.day).getUTCDay() + 6) % 7) + 1, lang)}`, value: d.revenue, text: money(d.revenue, lang) })));

  // 3. Menu.
  heading(t.menu);
  if (view.menu.length === 0) note(t.none);
  else {
    const w = (width - 170 - 90) / 4;
    table(
      [{ label: t.dish, w: 170 }, { label: t.group, w: 90 }, { label: t.qty, w, right: true }, { label: t.revenue, w, right: true }, { label: t.rating, w, right: true }, { label: t.ratings, w, right: true }],
      view.menu.map((d) => [d.name[lang], d.group ? MENU_GROUP_LABELS[d.group][lang] : "—", String(d.qty), money(d.revenue, lang), stars(d.ratingAvg, lang), String(d.ratingCount)]),
    );
  }

  // 4. Staff.
  heading(t.staff);
  {
    const costW = width - 115 - 60 - 85 - 40 - 50 - 50;
    table(
      [
        { label: t.name, w: 115 }, { label: t.role, w: 60 }, { label: t.hours, w: 85, right: true }, { label: t.late, w: 40, right: true },
        { label: t.rating, w: 50, right: true }, { label: t.points, w: 50, right: true }, { label: t.labourCost, w: costW, right: true },
      ],
      view.staff.map((r) => [
        r.name, t.roles[r.role] ?? r.role, `${hoursLabel(r.minutes, lang)} (${hoursLabel(r.plannedMinutes, lang)})`, String(r.lateShifts),
        stars(r.ratingAvg, lang), r.score === null ? "—" : dec(r.score, 1, lang), money(r.labourCost, lang),
      ]),
    );
  }
  sub(t.labourByGroup);
  bars((Object.keys(view.labourByGroup.cur) as ScheduleGroup[]).map((g) => ({ label: t.groups[g], value: view.labourByGroup.cur[g], text: money(view.labourByGroup.cur[g], lang) })));
  note(`${t.overtime}: ${hoursLabel(view.overtimeMinutes.cur, lang)} (${t.previous}: ${hoursLabel(view.overtimeMinutes.prev, lang)})`);

  // 5. Guests and ratings.
  const r = view.ratings;
  heading(t.guests);
  const ratingRow = (label: string, p: Pair<number | null>) => [label, stars(p.cur, lang), stars(p.prev, lang), p.cur === null || p.prev === null ? "—" : signedPct(pctChange(p.cur, p.prev), lang)];
  table(kpiCols, [ratingRow(t.restaurant, r.restaurant), ratingRow(t.food, r.food), ratingRow(t.cleanliness, r.cleanliness), ratingRow(t.atmosphere, r.atmosphere)]);
  sub(t.spread);
  {
    const w = (width - 130) / 5;
    table(
      [{ label: "", w: 130 }, ...[1, 2, 3, 4, 5].map((n) => ({ label: String(n), w, right: true }))],
      ([[t.restaurant, r.dist.restaurant.cur], [t.waiters, r.dist.waiter.cur], [t.dishes, r.dist.dish.cur]] as const).map(([label, d]) => [label, ...d.map(String)]),
    );
  }
  sub(t.byWeek);
  {
    const w = (width - 130) / 4;
    table(
      [{ label: t.week, w: 130 }, { label: t.restaurant, w, right: true }, { label: t.food, w, right: true }, { label: t.cleanliness, w, right: true }, { label: t.atmosphere, w, right: true }],
      r.byWeek.cur.map((wk) => [shortDate(wk.week, lang), stars(wk.restaurant, lang), stars(wk.food, lang), stars(wk.cleanliness, lang), stars(wk.atmosphere, lang)]),
    );
  }
  sub(t.comments);
  if (r.comments.length === 0) note(t.none);
  for (const c of r.comments) {
    doc.font(REGULAR).fontSize(9);
    const h = doc.heightOfString(c.comment, { width: width - 70 });
    room(h + 6);
    doc.fillColor(MUTED).text(shortDate(c.serviceDay, lang), left, y, { width: 64, lineBreak: false });
    doc.fillColor(INK).text(c.comment, left + 70, y, { width: width - 70 });
    y = doc.y + 4;
  }

  // 6. Expenses.
  const e = view.expenses;
  heading(t.expenses);
  bars(
    e.byCategory.cur.map((c) => ({
      label: c.name[lang],
      value: c.spent,
      text: c.budget > 0 ? `${money(c.spent, lang)} / ${money(c.budget, lang)}` : money(c.spent, lang),
      color: c.budget > 0 && c.spent > c.budget ? OVER : BAR,
    })),
    140,
  );
  note(`${t.spent}: ${money(e.total.cur, lang)} · ${t.budget}: ${money(e.budgetTotal, lang)} · ${t.previous}: ${money(e.total.prev, lang)}`);
  sub(t.biggest);
  if (e.biggest.length === 0) note(t.none);
  else {
    table(
      [{ label: t.date, w: 80 }, { label: t.category, w: 150 }, { label: t.payee, w: width - 80 - 150 - 100 }, { label: t.amount, w: 100, right: true }],
      e.biggest.map((x) => [shortDate(x.date, lang), x.category[lang], x.payee ?? "", money(x.amount, lang)]),
    );
  }
  return finish(doc);
}
