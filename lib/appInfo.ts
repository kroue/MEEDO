/**
 * lib/appInfo.ts
 *
 * Who made this console, who owns it, what it is built from, and which
 * build is running.
 *
 * Kept in one file because the same facts appear in several places — the
 * sidebar footer, the About page, and anything printed — and a copyright
 * year or version that disagrees with itself across a screen is the kind of
 * detail an auditor notices.
 */

export const APP_NAME = "MEEDO Admin Console";
export const SYSTEM_NAME = "South Wao Water System (MEEDO)";
export const SYSTEM_ADDRESS = "Wao, Lanao del Sur";

/** Keep in step with `version` in package.json. */
export const APP_VERSION = "2.4.1";

export const COPYRIGHT_YEAR = 2026;

/** Who the software belongs to. Answered by the office, not assumed here. */
export const COPYRIGHT_HOLDER = SYSTEM_NAME;

export const DEVELOPER = {
  name: "Aljohn Arranguez",
  email: "arranguez.aljohn0130@gmail.com",
  phone: "+63 953 538 3369",
} as const;

export interface OpenSourceComponent {
  name: string;
  version: string;
  licence: string;
  /** What it does here, so the list means something to a non-developer. */
  what: string;
}

/**
 * The third-party components this console ships to the browser, with the
 * licence each is distributed under. Development-only tooling (the compiler,
 * the test runner, the linter) is left out: none of it reaches anyone's
 * screen, so none of it is being redistributed.
 */
export const OPEN_SOURCE: OpenSourceComponent[] = [
  { name: "Next.js", version: "16.3.3", licence: "MIT", what: "Web framework" },
  { name: "React", version: "19.2.4", licence: "MIT", what: "User interface" },
  { name: "React DOM", version: "19.2.4", licence: "MIT", what: "User interface" },
  { name: "Base UI", version: "1.7.0", licence: "MIT", what: "Menus, dialogs and selects" },
  { name: "Tailwind CSS", version: "4.3.3", licence: "MIT", what: "Styling" },
  { name: "tw-animate-css", version: "1.4.0", licence: "MIT", what: "Animations" },
  { name: "tailwind-merge", version: "3.6.0", licence: "MIT", what: "Styling" },
  { name: "class-variance-authority", version: "0.7.1", licence: "Apache-2.0", what: "Styling" },
  { name: "clsx", version: "2.1.1", licence: "MIT", what: "Styling" },
  { name: "shadcn/ui", version: "—", licence: "MIT", what: "Component patterns" },
  { name: "Lucide", version: "1.35.0", licence: "ISC", what: "Icons" },
  { name: "Recharts", version: "3.10.1", licence: "MIT", what: "Dashboard charts" },
  { name: "jsPDF", version: "4.2.1", licence: "MIT", what: "PDF reports" },
  { name: "jsPDF AutoTable", version: "5.0.8", licence: "MIT", what: "PDF report tables" },
  { name: "SheetJS (xlsx)", version: "0.20.3", licence: "Apache-2.0", what: "Spreadsheet import" },
  {
    name: "Google client libraries",
    version: "12.18.0",
    licence: "Apache-2.0",
    what: "Sign-in and data storage",
  },
];

/**
 * When this build was made.
 *
 * Inlined by next.config.ts when the build runs, so it is the build's own
 * date in production and the dev server's start time while developing.
 */
export function buildTimeIso(): string | null {
  return process.env.NEXT_PUBLIC_BUILD_TIME || null;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Formats the build stamp the same way on the server and in the browser.
 *
 * Deliberately not `toLocaleString`: the page is prerendered, and a date
 * formatted in the server's timezone and then again in the reader's produces
 * two different strings for the same instant, which React reports as a
 * hydration mismatch.
 */
export function formatBuildTime(iso: string | null): string {
  if (!iso) return "Not recorded";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "Not recorded";
  const day = at.getUTCDate();
  const month = MONTHS[at.getUTCMonth()];
  const hh = String(at.getUTCHours()).padStart(2, "0");
  const mm = String(at.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${at.getUTCFullYear()}, ${hh}:${mm} UTC`;
}
