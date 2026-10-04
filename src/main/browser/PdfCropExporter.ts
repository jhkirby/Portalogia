// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

import { BlendMode, LineCapStyle, PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import type { RGB } from '@shared/color';
import type { PdfAnnotations } from '@shared/ipc-schemas';

/** A rectangle in a page's unrotated user space (origin bottom-left, y up). */
interface UserSpaceBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Maps a point on the page as displayed (fractions from its top-left, after rotation) into user space. */
type PointMapper = (u: number, v: number) => { x: number; y: number };

/** Pen width in PDF points — the viewer draws 3 CSS px, i.e. 2.25 pt. */
const PEN_WIDTH_PT = 2.25;

/** Same alpha the viewer paints highlights with. */
const HIGHLIGHT_OPACITY = 0.55;

/**
 * Writes a copy of a PDF with this app's marks baked in: pen strokes and
 * highlights are drawn onto their pages, and each cropped page gets a tighter
 * CropBox (page content stays intact; viewers show only the cropped area).
 * The original bytes are never modified. Comments aren't exported.
 */
export class PdfCropExporter {
  /**
   * @param source The original PDF's bytes.
   * @param annotations The marks saved for this document (page numbers are 1-based).
   * @param color The accent color the viewer paints strokes and highlights in.
   * @returns The bytes of the exported copy.
   */
  public async export(source: Uint8Array, annotations: PdfAnnotations, color: RGB): Promise<Uint8Array> {
    const doc = await PDFDocument.load(source, { ignoreEncryption: true });
    const pages = doc.getPages();
    const ink = rgb(color.r / 255, color.g / 255, color.b / 255);

    // Marks first, while every page still has its original box.
    for (const stroke of annotations.strokes) {
      const page = pages[stroke.page - 1];
      if (page) {
        PdfCropExporter.drawStroke(page, stroke.points, ink);
      }
    }
    for (const highlight of annotations.highlights) {
      const page = pages[highlight.page - 1];
      if (page) {
        PdfCropExporter.drawHighlight(page, highlight.rects, ink);
      }
    }

    for (const crop of annotations.crops) {
      const page = pages[crop.page - 1];
      if (!page) {
        continue;
      }
      const map = PdfCropExporter.mapperFor(page);
      const box = PdfCropExporter.boxFrom(map, crop.x, crop.y, crop.w, crop.h);
      page.setCropBox(box.x, box.y, box.width, box.height);
    }
    return doc.save();
  }

  private static drawStroke(page: PDFPage, points: readonly { x: number; y: number }[], color: ReturnType<typeof rgb>): void {
    const map = PdfCropExporter.mapperFor(page);
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      if (!from || !to) {
        continue;
      }
      page.drawLine({
        start: map(from.x, from.y),
        end: map(to.x, to.y),
        thickness: PEN_WIDTH_PT,
        color,
        lineCap: LineCapStyle.Round,
      });
    }
  }

  private static drawHighlight(
    page: PDFPage,
    rects: readonly { x: number; y: number; w: number; h: number }[],
    color: ReturnType<typeof rgb>,
  ): void {
    const map = PdfCropExporter.mapperFor(page);
    for (const rect of rects) {
      const box = PdfCropExporter.boxFrom(map, rect.x, rect.y, rect.w, rect.h);
      // Multiply, like the viewer, so the text underneath stays readable through the tint.
      page.drawRectangle({ ...box, color, opacity: HIGHLIGHT_OPACITY, blendMode: BlendMode.Multiply });
    }
  }

  /**
   * Builds the displayed-fraction → user-space mapping for a page, accounting
   * for its /Rotate value and its current visible box (CropBox, else MediaBox)
   * — the same area pdf.js lays out in the viewer.
   */
  private static mapperFor(page: PDFPage): PointMapper {
    const base: UserSpaceBox = page.getCropBox();
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    return (u, v) => {
      // Fractions of the unrotated box from its left (a) and bottom (b) edges.
      let a: number;
      let b: number;
      switch (angle) {
        case 90:
          a = v;
          b = u;
          break;
        case 180:
          a = 1 - u;
          b = v;
          break;
        case 270:
          a = 1 - v;
          b = 1 - u;
          break;
        default:
          a = u;
          b = 1 - v;
      }
      return { x: base.x + a * base.width, y: base.y + b * base.height };
    };
  }

  /** The user-space box covering a displayed rectangle (fractions from the page's top-left). */
  private static boxFrom(map: PointMapper, x: number, y: number, w: number, h: number): UserSpaceBox {
    const p0 = map(x, y);
    const p1 = map(x + w, y + h);
    return {
      x: Math.min(p0.x, p1.x),
      y: Math.min(p0.y, p1.y),
      width: Math.abs(p1.x - p0.x),
      height: Math.abs(p1.y - p0.y),
    };
  }
}
