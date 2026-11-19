import { describe, expect, it } from "vitest";
import { browserAddress } from "./browser-address";
describe("browser addresses", () => {
  it("accepts explicit web addresses and defaults public hosts to HTTPS", () => {
    expect(browserAddress(" example.com/docs ")).toBe(
      "https://example.com/docs",
    );
    expect(browserAddress("https://example.com")).toBe("https://example.com");
  });
  it("recognizes local development servers without treating the hostname as a scheme", () => {
    expect(browserAddress("localhost:3000/app")).toBe(
      "http://localhost:3000/app",
    );
    expect(browserAddress("127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
    expect(browserAddress("[::1]:8000")).toBe("http://[::1]:8000");
    expect(browserAddress("javascript:alert(1)")).toBe("javascript:alert(1)");
  });
});
