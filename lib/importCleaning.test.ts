/**
 * Tests for lib/importCleaning.ts.
 *
 * The inputs are the ways the office's own spreadsheets have been seen to
 * write things. Each case pins what is stored and whether the import page is
 * told — silently fixed, fixed with a note, flagged to check, or refused.
 */

import { describe, expect, it } from "vitest";
import {
  cleanBarangay,
  cleanClassification,
  cleanDisconnectedReason,
  cleanMeterNo,
  cleanMiddleName,
  cleanMoney,
  cleanMonth,
  cleanName,
  cleanPurok,
  cleanSlot,
  cleanStatus,
  isHeaderText,
  type Cleaned,
} from "./importCleaning";

/** The stored value, failing the test if the cleaner refused. */
function value<T>(c: Cleaned<T>): T {
  if (!c.ok) throw new Error(`refused: ${c.note}`);
  return c.value;
}
const levels = <T,>(c: Cleaned<T>) => (c.ok ? c.changes.map((x) => x.level) : ["refused"]);

describe("names", () => {
  it("puts a name typed in capitals or lower case into proper case", () => {
    expect(value(cleanName("JOSEPHINE"))).toBe("Josephine");
    expect(value(cleanName("dela cruz"))).toBe("Dela Cruz");
    expect(value(cleanName("MARY GRACE"))).toBe("Mary Grace");
    expect(levels(cleanName("JOSEPHINE"))).toEqual(["fixed"]);
  });

  it("keeps Ñ through the change of case", () => {
    expect(value(cleanName("CAÑETE"))).toBe("Cañete");
  });

  it("leaves a mixed-case name as its owner spells it", () => {
    expect(value(cleanName("De Guzman"))).toBe("De Guzman");
    expect(levels(cleanName("De Guzman"))).toEqual([]);
  });

  it("drops spaces at the ends silently and doubled ones with a note", () => {
    expect(value(cleanName("  Jose "))).toBe("Jose");
    expect(levels(cleanName("  Jose "))).toEqual([]);
    expect(value(cleanName("Mark  Anthony"))).toBe("Mark Anthony");
    expect(levels(cleanName("Mark  Anthony"))).toEqual(["fixed"]);
  });

  it("writes every Jr. the same way", () => {
    for (const typed of ["Cabahug JR", "Cabahug, Jr.", "Cabahug jr", "Cabahug Jr", "CABAHUG JR"]) {
      expect(value(cleanName(typed))).toBe("Cabahug Jr.");
    }
    expect(levels(cleanName("Cabahug Jr."))).toEqual([]);
    expect(value(cleanName("SANTOS III"))).toBe("Santos III");
  });

  it("flags a title in a first name but keeps it — that's the office's call", () => {
    const hadji = cleanName("Hadji Abdul", { first: true });
    expect(value(hadji)).toBe("Hadji Abdul");
    expect(levels(hadji)).toEqual(["check"]);
    // Only first names, and only a title followed by a name.
    expect(levels(cleanName("Bai", { first: true }))).toEqual([]);
  });

  it("gives a middle initial its capital and full stop", () => {
    expect(value(cleanMiddleName("E"))).toBe("E.");
    expect(value(cleanMiddleName("e."))).toBe("E.");
    expect(levels(cleanMiddleName("E."))).toEqual([]);
    expect(value(cleanMiddleName("cagas"))).toBe("Cagas");
  });
});

describe("barangay", () => {
  it("reads spacing, case and punctuation variants as the code, silently", () => {
    for (const typed of ["Bo-ot", "BOOT", "Bo ot", "Boot", " bo-ot "]) {
      expect(value(cleanBarangay(typed))).toBe("BO-OT");
      expect(levels(cleanBarangay(typed))).toEqual([]);
    }
    expect(value(cleanBarangay("Kabatang-an"))).toBe("KABATANGAN");
    expect(value(cleanBarangay("C.G."))).toBe("CG");
  });

  it("changes Cebuano Group to its code, with a note", () => {
    for (const typed of ["Cebuano Group", "CEBUANO GRP"]) {
      expect(value(cleanBarangay(typed))).toBe("CG");
      expect(levels(cleanBarangay(typed))).toEqual(["fixed"]);
    }
  });

  it("corrects a misspelling a letter off, and asks for it to be checked", () => {
    const cases: [string, string][] = [
      ["Katutongan", "KATUTUNGAN"],
      ["Pagalungan", "PAGALONGAN"],
      ["Salvasion", "SALVACION"],
      ["Amoyung", "AMOYONG"],
      ["Diomel", "DIOMIL"],
    ];
    for (const [typed, expected] of cases) {
      expect(value(cleanBarangay(typed))).toBe(expected);
      expect(levels(cleanBarangay(typed))).toEqual(["check"]);
    }
  });

  it("refuses a name that isn't close to any of the nine", () => {
    expect(cleanBarangay("Poblacion").ok).toBe(false);
    expect(cleanBarangay("CX").ok).toBe(false); // short codes get no leeway
    expect(cleanBarangay("").ok).toBe(false);
  });
});

describe("classification, status and reason", () => {
  it("maps the office's abbreviations", () => {
    expect(value(cleanClassification("Comm A"))).toBe("COMMERCIAL A");
    expect(value(cleanClassification("Com. B"))).toBe("COMMERCIAL B");
    expect(value(cleanClassification("Gov't"))).toBe("GOVERNMENT");
    expect(value(cleanClassification("Government Office"))).toBe("GOVERNMENT");
    expect(value(cleanClassification("RES"))).toBe("RESIDENTIAL");
    expect(levels(cleanClassification("Comm A"))).toEqual(["fixed"]);
    expect(levels(cleanClassification("commercial a"))).toEqual([]);
  });

  it("imports an unknown classification as RESIDENTIAL but never silently", () => {
    const industrial = cleanClassification("INDUSTRIAL");
    expect(value(industrial)).toBe("RESIDENTIAL");
    expect(levels(industrial)).toEqual(["check"]);
  });

  it("reads DISCO and friends as DISCONNECTED rather than defaulting to CONNECTED", () => {
    for (const typed of ["DISCO", "Cut off", "DISCONNECTED - NP", "disconnected"]) {
      expect(value(cleanStatus(typed))).toBe("DISCONNECTED");
    }
    expect(value(cleanStatus("ACTIVE"))).toBe("CONNECTED");
    expect(levels(cleanStatus("ACTIVE"))).toEqual(["fixed"]);
    expect(levels(cleanStatus("Connected"))).toEqual([]);
  });

  it("flags an unknown status instead of assuming it", () => {
    const odd = cleanStatus("pending");
    expect(value(odd)).toBe("CONNECTED");
    expect(levels(odd)).toEqual(["check"]);
  });

  it("maps disconnection reasons, leaving an unknown one off with a flag", () => {
    expect(value(cleanDisconnectedReason("NON PAYMENT"))).toBe("NON-PAYMENT");
    expect(value(cleanDisconnectedReason("Unpaid bills"))).toBe("NON-PAYMENT");
    expect(value(cleanDisconnectedReason("Voluntary"))).toBe("VOLUNTARY DISCONNECTION");
    expect(value(cleanDisconnectedReason("ILLEGAL CONN."))).toBe("ILLEGAL CONNECTIONS");
    expect(value(cleanDisconnectedReason(""))).toBe("");
    expect(levels(cleanDisconnectedReason("non-payment"))).toEqual([]);
    const odd = cleanDisconnectedReason("moved away");
    expect(value(odd)).toBe("");
    expect(levels(odd)).toEqual(["check"]);
  });
});

describe("purok and meter number", () => {
  it("strips the Purok label however it's written", () => {
    for (const typed of ["Purok 3", "Prk. 3", "P-3", "purok3", "Purok-3", "P3"]) {
      expect(value(cleanPurok(typed))).toBe("3");
    }
    expect(value(cleanPurok("Purok Malipayon"))).toBe("Malipayon");
    expect(value(cleanPurok("Pag-asa"))).toBe("Pag-asa");
    expect(levels(cleanPurok("3"))).toEqual([]);
  });

  it("writes every meter number as MTR- and digits", () => {
    for (const typed of ["mtr-710006", "MTR 710013", "MTR710014", " MTR-710008  "]) {
      expect(value(cleanMeterNo(typed))).toMatch(/^MTR-7100\d\d$/);
    }
    expect(levels(cleanMeterNo(" MTR-710008  "))).toEqual([]);
    expect(levels(cleanMeterNo("mtr-710006"))).toEqual(["fixed"]);
  });

  it("guesses — and says so — at a bare number or a letter O", () => {
    expect(value(cleanMeterNo(710015))).toBe("MTR-710015");
    expect(levels(cleanMeterNo(710015))).toEqual(["check"]);
    expect(value(cleanMeterNo("710015"))).toBe("MTR-710015");
    expect(value(cleanMeterNo("MTR-71OO16"))).toBe("MTR-710016");
    expect(levels(cleanMeterNo("MTR-71OO16"))).toEqual(["check"]);
  });

  it("keeps another meter format as typed, in capitals", () => {
    expect(value(cleanMeterNo("ab-12x"))).toBe("AB-12X");
  });

  it("recognises a header row pasted into the data", () => {
    expect(isHeaderText("Meter No")).toBe(true);
    expect(isHeaderText("meter no.")).toBe(true);
    expect(isHeaderText("MTR-710001")).toBe(false);
  });
});

describe("amounts", () => {
  it("reads the ways people type pesos — the importer used to read these as zero", () => {
    const cases: [unknown, number][] = [
      ["₱1,250.00", 1250],
      ["1,250", 1250],
      ["PHP 420.50", 420.5],
      ["P980.00", 980],
      ["P 980", 980],
      ["  350 ", 350],
      [1600, 1600],
    ];
    for (const [typed, expected] of cases) expect(value(cleanMoney(typed))).toBe(expected);
    expect(levels(cleanMoney("₱1,250.00"))).toEqual(["fixed"]);
    expect(levels(cleanMoney("  350 "))).toEqual([]);
  });

  it("rounds to centavos", () => {
    expect(value(cleanMoney(345.555))).toBe(345.56);
    expect(levels(cleanMoney(345.555))).toEqual(["fixed"]);
  });

  it("keeps words typed after the number for a caller that can use them", () => {
    const pipes = cleanMoney("200 (pipes)");
    expect(value(pipes)).toBe(200);
    expect(pipes.ok && pipes.leftover).toBe("pipes");
    expect(levels(pipes)).toEqual(["check"]);
  });

  it("reads a lone dash as zero and a blank as zero", () => {
    expect(value(cleanMoney("-"))).toBe(0);
    expect(value(cleanMoney(""))).toBe(0);
    expect(value(cleanMoney(null))).toBe(0);
  });

  it("refuses a negative or unreadable amount rather than guessing", () => {
    expect(cleanMoney(-120).ok).toBe(false);
    expect(cleanMoney("-120").ok).toBe(false);
    expect(cleanMoney("(120.00)").ok).toBe(false);
    expect(cleanMoney("paid").ok).toBe(false);
  });
});

describe("billing months and installment slots", () => {
  it("writes months the way bills are keyed", () => {
    const cases: [unknown, string][] = [
      ["JUL 2026", "JUL 2026"],
      ["July 2026", "JUL 2026"],
      ["Jul-26", "JUL 2026"],
      ["07/2026", "JUL 2026"],
      ["2026-07", "JUL 2026"],
      ["Sept 2026", "SEP 2026"],
      [new Date(2026, 6, 1), "JUL 2026"],
    ];
    for (const [typed, expected] of cases) expect(value(cleanMonth(typed))).toBe(expected);
    expect(levels(cleanMonth("jul 2026"))).toEqual([]);
    expect(levels(cleanMonth("July 2026"))).toEqual(["fixed"]);
    expect(cleanMonth("13/2026").ok).toBe(false);
    expect(cleanMonth("summer").ok).toBe(false);
  });

  it("reads installment slots", () => {
    expect(value(cleanSlot("first"))).toBe("1st");
    expect(value(cleanSlot("2"))).toBe("2nd");
    expect(value(cleanSlot("Full payment"))).toBe("Full");
    expect(value(cleanSlot(""))).toBe("Full");
    expect(levels(cleanSlot("1st"))).toEqual([]);
    expect(cleanSlot("5th").ok).toBe(false);
  });
});
