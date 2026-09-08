// Next.js remounts `template.tsx` on every navigation (unlike layout.tsx,
// which persists), so this fade + slide-up re-triggers each time a page is
// opened — for every route, with a single file instead of per-page classes.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 ease-snappy">
      {children}
    </div>
  );
}
