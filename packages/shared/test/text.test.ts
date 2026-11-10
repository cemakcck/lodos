import { describe, expect, it } from "vitest";
import { fold, maskProfanity, noteMentionsAllergy } from "../src/index";

describe("text", () => {
  it("folds Turkish", () => {
    expect(fold("Şiş")).toBe("sis");
    expect(fold("İskender")).toBe("iskender");
    expect(fold("ÇOBAN")).toBe("coban");
  });
  it("detects allergy notes", () => {
    expect(noteMentionsAllergy("fıstık alerjim var")).toBe(true);
    expect(noteMentionsAllergy("Gluten free please")).toBe(true);
    expect(noteMentionsAllergy("extra lemon")).toBe(false);
    for (const t of ["FISTIK var", "ALERJİ", "COLYAK", "fistik", "findik", "nuts please", "peanut"]) {
      expect(noteMentionsAllergy(t), t).toBe(true);
    }
    for (const t of ["5 minutes", "donut"]) expect(noteMentionsAllergy(t), t).toBe(false);
  });
  it("masks profanity", () => {
    expect(maskProfanity("what the fuck")).toBe("what the •••");
    expect(maskProfanity("Siktir git")).toBe("••• git");
    expect(maskProfanity("SİKTİR")).toBe("•••");
    expect(maskProfanity("Please add extra lemon, no ice")).toBe("Please add extra lemon, no ice");
    expect(maskProfanity("Scunthorpe class")).toBe("Scunthorpe class");
  });
});
