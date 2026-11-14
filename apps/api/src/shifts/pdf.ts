import type { ScheduleGroup, ScheduleWarning, ShiftArea } from "@lodos/shared";
import { SHIFT_LIMITS } from "@lodos/shared";
import PDFDocument from "pdfkit";
import { fontPath } from "./fonts";
import type { ShiftRow, WeekView } from "./service";

export type PdfLang = "en" | "tr";

/** The week view plus the restaurant's name: everything the PDFs print. */
export type PdfWeekData = { restaurant: string; view: WeekView };
export type PersonalData = {
  restaurant: string;
  week: string;
  days: string[];
  person: { id: string; name: string };
  shifts: ShiftRow[];
  minutes: number;
};

const AREA_LABELS: Record<ShiftArea, Record<PdfLang, string>> = {
  salon: { en: "Salon", tr: "Salon" },
  bar: { en: "Bar", tr: "Bar" },
  terrace: { en: "Terrace", tr: "Teras" },
  kitchen: { en: "Kitchen", tr: "Mutfak" },
  bar_station: { en: "Bar station", tr: "Bar istasyonu" },
};
const GROUP_LABELS: Record<ScheduleGroup, Record<PdfLang, string>> = {
  floor: { en: "Floor", tr: "Servis" },
  kitchen: { en: "Kitchen", tr: "Mutfak" },
  bar: { en: "Bar", tr: "Bar" },
  managers: { en: "Managers", tr: "Yöneticiler" },
};
const T = {
  en: {
    week: "Week of",
    total: "Total",
    date: "Date",
    day: "Day",
    time: "Time",
    area: "Area",
    note: "Note",
    totalHours: "Total hours",
    none: "No shifts this week",
    legend: "Amber outline",
    warn: {
      week_hours: `over ${SHIFT_LIMITS.weekH} h in the week`,
      day_hours: `over ${SHIFT_LIMITS.dayH} h in a day`,
      rest: `under ${SHIFT_LIMITS.restH} h of rest between shifts`,
      inactive: "inactive person",
    },
    h: "h",
  },
  tr: {
    week: "haftası",
    total: "Toplam",
    date: "Tarih",
    day: "Gün",
    time: "Saat",
    area: "Alan",
    note: "Not",
    totalHours: "Toplam saat",
    none: "Bu hafta vardiya yok",
    legend: "Turuncu çerçeve",
    warn: {
      week_hours: `haftada ${SHIFT_LIMITS.weekH} saatten fazla`,
      day_hours: `günde ${SHIFT_LIMITS.dayH} saatten fazla`,
      rest: `vardiyalar arasında ${SHIFT_LIMITS.restH} saatten az dinlenme`,
      inactive: "pasif kişi",
    },
    h: "sa",
  },
} as const;

export const REGULAR = "Inter";
export const BOLD = "Inter-SemiBold";
export const INK = "#1f2937";
export const MUTED = "#6b7280";
export const LINE = "#d1d5db";
export const BAND = "#f3f4f6";
const AMBER = "#d97706";

const utc = (day: string): Date => new Date(`${day}T00:00:00Z`);
const locale = (lang: PdfLang): string => (lang === "tr" ? "tr-TR" : "en-GB");

export const dayName = (day: string, lang: PdfLang): string =>
  new Intl.DateTimeFormat(locale(lang), { weekday: "long", timeZone: "UTC" }).format(utc(day));

/** English months from en-US ("Sep"; en-GB prints "Sept"); Turkish months in full. */
const monthName = (day: string, lang: PdfLang): string =>
  new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-US", { month: lang === "tr" ? "long" : "short", timeZone: "UTC" }).format(utc(day));

const dayOfMonth = (day: string): number => Number(day.slice(8));

/** "9 Nov" / "9 Kasım". */
const shortDate = (day: string, lang: PdfLang): string => `${dayOfMonth(day)} ${monthName(day, lang)}`;

/** "9–15 Nov 2026", "30 Nov–6 Dec 2026", "29 Dec 2026–4 Jan 2027". */
function rangeLabel(days: string[], lang: PdfLang): string {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  if (first.slice(0, 4) !== last.slice(0, 4)) return `${shortDate(first, lang)} ${first.slice(0, 4)}–${shortDate(last, lang)} ${last.slice(0, 4)}`;
  if (first.slice(5, 7) !== last.slice(5, 7)) return `${shortDate(first, lang)}–${shortDate(last, lang)} ${last.slice(0, 4)}`;
  return `${dayOfMonth(first)}–${dayOfMonth(last)} ${monthName(last, lang)} ${last.slice(0, 4)}`;
}

/** "Week of 9–15 Nov 2026" / "9–15 Kasım 2026 haftası". */
const weekTitle = (days: string[], lang: PdfLang): string =>
  lang === "tr" ? `${rangeLabel(days, lang)} ${T.tr.week}` : `${T.en.week} ${rangeLabel(days, lang)}`;

/** "47 h" / "47 sa"; one decimal only when not whole ("7.5 h" / "7,5 sa"). */
export function hoursLabel(minutes: number, lang: PdfLang): string {
  const h = minutes / 60;
  const n = Number.isInteger(h) ? String(h) : h.toFixed(1);
  return `${lang === "tr" ? n.replace(".", ",") : n} ${T[lang].h}`;
}

/** An A4 document with Inter (Turkish glyphs) registered as REGULAR and BOLD. */
export function newDoc(opts: { layout: "portrait" | "landscape" }): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "A4", layout: opts.layout, margin: 36, font: fontPath("Inter-Regular.ttf"), info: { Producer: "Lodos" } });
  doc.registerFont(REGULAR, fontPath("Inter-Regular.ttf"));
  doc.registerFont(BOLD, fontPath("Inter-SemiBold.ttf"));
  return doc;
}

/** Ends `doc` and resolves with its bytes. */
export function finish(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/** One week, everyone: groups and people down the side, Monday to Sunday across (A4 landscape). */
export async function weekRosterPdf(data: PdfWeekData, lang: PdfLang): Promise<Buffer> {
  const { view, restaurant } = data;
  const t = T[lang];
  const doc = newDoc({ layout: "landscape" });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom;
  const nameW = 110;
  const totalW = 52;
  const dayW = (width - nameW - totalW) / view.days.length;
  const colX = (i: number) => left + nameW + i * dayW;

  const flagged = new Set(view.warnings.flatMap((w) => w.shiftIds));
  const kinds = [...new Set(view.warnings.map((w) => w.kind))] as ScheduleWarning["kind"][];

  doc.font(BOLD).fontSize(16).fillColor(INK).text(`${restaurant} · ${weekTitle(view.days, lang)}`, left, 36);
  let y = doc.y + 10;

  const header = () => {
    doc.rect(left, y, width, 30).fill(BAND);
    doc.fillColor(INK).font(BOLD).fontSize(9);
    view.days.forEach((d, i) => {
      doc.text(dayName(d, lang), colX(i) + 4, y + 5, { width: dayW - 8, lineBreak: false });
      doc.font(REGULAR).fillColor(MUTED).fontSize(8).text(shortDate(d, lang), colX(i) + 4, y + 17, { width: dayW - 8, lineBreak: false });
      doc.font(BOLD).fillColor(INK).fontSize(9);
    });
    doc.text(t.total, colX(view.days.length) + 4, y + 10, { width: totalW - 8, lineBreak: false });
    y += 30;
  };
  header();

  const LINE_H = 10;
  const groups = [...new Set(view.people.map((p) => p.group))];
  for (const group of groups) {
    if (y + 16 + 30 > bottom) {
      doc.addPage();
      y = 36;
      header();
    }
    doc.font(BOLD).fontSize(8).fillColor(MUTED).text(GROUP_LABELS[group][lang].toUpperCase(), left + 4, y + 5, { lineBreak: false });
    y += 16;
    for (const person of view.people.filter((p) => p.group === group)) {
      const mine = view.shifts.filter((s) => s.staffId === person.id);
      const perDay = view.days.map((d) => mine.filter((s) => s.serviceDay === d));
      const rowH = Math.max(1, ...perDay.map((s) => s.length)) * (LINE_H * 2 + 4) + 8;
      if (y + rowH > bottom) {
        doc.addPage();
        y = 36;
        header();
      }
      doc.moveTo(left, y + rowH).lineTo(left + width, y + rowH).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font(BOLD).fontSize(9).fillColor(person.active ? INK : MUTED).text(person.name, left + 4, y + 5, { width: nameW - 8, lineBreak: false, ellipsis: true });
      perDay.forEach((shifts, i) => {
        shifts.forEach((s, k) => {
          const top = y + 4 + k * (LINE_H * 2 + 4);
          const warn = flagged.has(s.id);
          if (warn) doc.roundedRect(colX(i) + 2, top, dayW - 4, LINE_H * 2 + 2, 2).lineWidth(1.2).strokeColor(AMBER).stroke();
          doc.font(BOLD).fontSize(8).fillColor(INK).text(`${s.start}–${s.end}`, colX(i) + 5, top + 2, { width: dayW - 10, lineBreak: false });
          doc.font(REGULAR).fontSize(8).fillColor(MUTED).text(AREA_LABELS[s.area][lang], colX(i) + 5, top + 2 + LINE_H, { width: dayW - 10, lineBreak: false, ellipsis: true });
        });
      });
      doc.font(BOLD).fontSize(9).fillColor(INK).text(hoursLabel(view.totals.byPerson[person.id] ?? 0, lang), colX(view.days.length) + 4, y + 5, { width: totalW - 8, lineBreak: false });
      y += rowH;
    }
  }

  // Day totals.
  if (y + 24 > bottom) {
    doc.addPage();
    y = 36;
    header();
  }
  doc.rect(left, y, width, 20).fill(BAND);
  doc.font(BOLD).fontSize(9).fillColor(INK).text(t.total, left + 4, y + 6, { lineBreak: false });
  view.days.forEach((d, i) => doc.text(hoursLabel(view.totals.byDay[d] ?? 0, lang), colX(i) + 4, y + 6, { width: dayW - 8, lineBreak: false }));
  y += 28;

  if (kinds.length > 0) {
    if (y + 14 > bottom) {
      doc.addPage();
      y = 36;
    }
    const text = `${t.legend}: ${kinds.map((k) => t.warn[k]).join(" · ")}`;
    doc.roundedRect(left, y, 14, 9, 2).lineWidth(1.2).strokeColor(AMBER).stroke();
    doc.font(REGULAR).fontSize(8).fillColor(MUTED).text(text, left + 20, y + 1, { width: width - 20 });
  }
  return finish(doc);
}

/** One person's page (A4 portrait) on `doc`: name, week, a row per shift and the total. */
function personalPage(doc: PDFKit.PDFDocument, data: PersonalData, lang: PdfLang): void {
  const t = T[lang];
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const cols = [
    { x: 0, w: 70, label: t.date },
    { x: 70, w: 90, label: t.day },
    { x: 160, w: 100, label: t.time },
    { x: 260, w: 90, label: t.area },
    { x: 350, w: width - 350, label: t.note },
  ];
  doc.font(BOLD).fontSize(20).fillColor(INK).text(data.person.name, left, 48, { width });
  doc.font(REGULAR).fontSize(11).fillColor(MUTED).text(`${data.restaurant} · ${weekTitle(data.days, lang)}`, left, doc.y + 2, { width });
  let y = doc.y + 22;
  doc.rect(left, y, width, 22).fill(BAND);
  doc.font(BOLD).fontSize(9).fillColor(INK);
  for (const c of cols) doc.text(c.label, left + c.x + 6, y + 7, { width: c.w - 8, lineBreak: false });
  y += 22;

  if (data.shifts.length === 0) {
    doc.font(REGULAR).fontSize(11).fillColor(MUTED).text(t.none, left + 6, y + 12);
  }
  for (const s of data.shifts) {
    doc.font(REGULAR).fontSize(10);
    const noteH = s.note ? doc.heightOfString(s.note, { width: cols[4]!.w - 8 }) : 0;
    const rowH = Math.max(26, noteH + 14);
    if (y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = 48;
    }
    const cells = [shortDate(s.serviceDay, lang), dayName(s.serviceDay, lang), `${s.start}–${s.end}`, AREA_LABELS[s.area][lang], s.note ?? ""];
    cells.forEach((text, i) => {
      doc.font(i === 2 ? BOLD : REGULAR).fillColor(INK).text(text, left + cols[i]!.x + 6, y + 8, { width: cols[i]!.w - 8, lineBreak: i === 4 });
    });
    doc.moveTo(left, y + rowH).lineTo(left + width, y + rowH).lineWidth(0.5).strokeColor(LINE).stroke();
    y += rowH;
  }
  y += 16;
  if (y + 20 > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
    y = 48;
  }
  doc.font(BOLD).fontSize(12).fillColor(INK).text(`${t.totalHours}: ${hoursLabel(data.minutes, lang)}`, left + 6, y, { width: width - 6 });
}

/** One person's week (A4 portrait). */
export async function personalPdf(data: PersonalData, lang: PdfLang): Promise<Buffer> {
  const doc = newDoc({ layout: "portrait" });
  personalPage(doc, data, lang);
  return finish(doc);
}

/** One page per person who has shifts (a single "no shifts" page when nobody does). */
export async function allPersonalPdf(all: PersonalData[], lang: PdfLang, empty: PersonalData): Promise<Buffer> {
  const doc = newDoc({ layout: "portrait" });
  const pages = all.filter((d) => d.shifts.length > 0);
  (pages.length > 0 ? pages : [empty]).forEach((d, i) => {
    if (i > 0) doc.addPage();
    personalPage(doc, d, lang);
  });
  return finish(doc);
}

/** The week's data for one person, from the week view. */
export function personalData(restaurant: string, view: WeekView, person: { id: string; name: string }): PersonalData {
  const shifts = view.shifts.filter((s) => s.staffId === person.id);
  return { restaurant, week: view.week, days: view.days, person, shifts, minutes: view.totals.byPerson[person.id] ?? shifts.reduce((n, s) => n + s.minutes, 0) };
}

/** The ASCII slug of a name for filenames: Turkish letters folded, the rest as hyphens. */
export const slug = (name: string): string =>
  name
    .replace(/İ/g, "i")
    .replace(/ı/g, "i")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "person";
