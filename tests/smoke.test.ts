import { describe, expect, it } from "vitest";

describe("project smoke test", () => {
  it("uses a valid service name", () => {
    expect("prompt-architect-telegram").toMatch(/^[a-z0-9-]+$/);
  });
});
