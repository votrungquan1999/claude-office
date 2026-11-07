import { useEffect, useRef } from "react";
import {
  MUGSHOT_CROP_LEFT_COL,
  MUGSHOT_CROP_SIDE_PX,
  MUGSHOT_CROP_TOP_ROW,
  MUGSHOT_DISPLAY_PX,
  MUGSHOT_RENDER_ZOOM,
} from "../constants";
import { getCachedSprite } from "../sprites/spriteCache";
import { getCharacterSprites } from "../sprites/spriteData";
import { Direction } from "../types";

interface CharacterMugShotProps {
  palette: number;
  hueShift: number;
}

/**
 * The head of an employee's front-facing sprite, scaled up crisply, as the card's picture.
 * @param props - The employee's palette and hue shift.
 * @returns A small canvas.
 */
export function CharacterMugShot({ palette, hueShift }: CharacterMugShotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const front = getCharacterSprites(palette, hueShift).walk[
      Direction.DOWN
    ][0];
    const full = getCachedSprite(front, MUGSHOT_RENDER_ZOOM);
    const side = MUGSHOT_CROP_SIDE_PX * MUGSHOT_RENDER_ZOOM;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, side, side);
    ctx.drawImage(
      full,
      MUGSHOT_CROP_LEFT_COL * MUGSHOT_RENDER_ZOOM,
      MUGSHOT_CROP_TOP_ROW * MUGSHOT_RENDER_ZOOM,
      side,
      side,
      0,
      0,
      side,
      side,
    );
  }, [palette, hueShift]);

  return (
    <canvas
      ref={canvasRef}
      width={MUGSHOT_CROP_SIDE_PX * MUGSHOT_RENDER_ZOOM}
      height={MUGSHOT_CROP_SIDE_PX * MUGSHOT_RENDER_ZOOM}
      style={{
        width: MUGSHOT_DISPLAY_PX,
        height: MUGSHOT_DISPLAY_PX,
        imageRendering: "pixelated",
      }}
    />
  );
}
