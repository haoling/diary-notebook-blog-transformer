import { describe, expect, it } from "vitest";
import { createDefaultPerspectiveParams } from "./image-processing";

describe("createDefaultPerspectiveParams", () => {
  it("既定の余白率 5% で内側に縮めた 4 隅を返す", () => {
    expect(createDefaultPerspectiveParams(1000, 2000)).toEqual({
      topLeft: { x: 50, y: 100 },
      topRight: { x: 949, y: 100 },
      bottomRight: { x: 949, y: 1899 },
      bottomLeft: { x: 50, y: 1899 },
    });
  });

  it("余白率 0 なら画像全体（右下は最大座標）を囲む", () => {
    expect(createDefaultPerspectiveParams(100, 200, 0)).toEqual({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 99, y: 0 },
      bottomRight: { x: 99, y: 199 },
      bottomLeft: { x: 0, y: 199 },
    });
  });

  it("極小画像や過大な余白率でも画像範囲内に収まる", () => {
    for (const [w, h, m] of [[1, 1, 0.05], [10, 10, 0.9], [0, 0, 0.05]] as const) {
      const p = createDefaultPerspectiveParams(w, h, m);
      for (const pt of Object.values(p)) {
        expect(pt.x).toBeGreaterThanOrEqual(0);
        expect(pt.y).toBeGreaterThanOrEqual(0);
        expect(pt.x).toBeLessThanOrEqual(Math.max(0, w - 1));
        expect(pt.y).toBeLessThanOrEqual(Math.max(0, h - 1));
      }
    }
  });
});
