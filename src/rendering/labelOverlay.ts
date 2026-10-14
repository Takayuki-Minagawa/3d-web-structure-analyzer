import * as THREE from 'three';
import { formatEngineering } from '../core/formatEngineering';
import { memberLabel, nodeLabel } from '../core/model/displayNumbers';
import type { AnalysisResult, DiagramPoint, ProjectModel } from '../core/model/types';
import { isForceDiagramMode, type DisplayMode, type LabelMode } from '../state/viewStore';
import { LABEL_FONT, THEME_COLORS } from './constants';
import { projectToScreen } from './interactionHelpers';
import { getDiagramLabelPosition, getDiagramValue } from './resultGeometry';
import type { SupportPresentation } from './supportPresentation';

interface LabelRectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LabelDrawOptions {
  model: ProjectModel | null;
  result: AnalysisResult | null;
  camera: THREE.Camera;
  displayMode: DisplayMode;
  diagramScale: number;
  isDark: boolean;
  showNodeLabels: boolean;
  showMemberLabels: boolean;
  showSupports: boolean;
  supports: readonly SupportPresentation[];
  loadCaption: string;
  labelMode: LabelMode;
  selectedNodeIds: ReadonlySet<string>;
  selectedMemberIds: ReadonlySet<string>;
}

export class LabelOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private cssWidth = 1;
  private cssHeight = 1;
  private pixelRatio = 1;
  private occupied: LabelRectangle[] = [];

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;width:100%;height:100%;';
    container.appendChild(this.canvas);
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('2D label canvas is not available.');
    this.context = context;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.cssWidth = Math.max(1, width);
    this.cssHeight = Math.max(1, height);
    this.pixelRatio = Math.max(1, pixelRatio);
    const backingWidth = Math.max(1, Math.round(this.cssWidth * this.pixelRatio));
    const backingHeight = Math.max(1, Math.round(this.cssHeight * this.pixelRatio));
    if (this.canvas.width !== backingWidth) this.canvas.width = backingWidth;
    if (this.canvas.height !== backingHeight) this.canvas.height = backingHeight;
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
  }

  draw(options: LabelDrawOptions): void {
    this.context.clearRect(0, 0, this.cssWidth, this.cssHeight);
    this.occupied = [];
    if (!options.model) return;

    const diagramLabelsVisible = options.result && isForceDiagramMode(options.displayMode);
    const colors = options.isDark ? THEME_COLORS.dark : THEME_COLORS.light;
    this.context.font = LABEL_FONT;
    this.context.textAlign = 'center';
    this.context.textBaseline = 'bottom';

    this.drawLoadCaption(options.loadCaption, colors.labelBackground, colors.labelDiagram);
    if (options.showNodeLabels) this.drawNodeLabels(options, colors.labelNode);
    if (options.showSupports) this.drawSupportLabels(options, colors.labelBackground, colors.labelNode);
    if (options.showMemberLabels) this.drawMemberLabels(options, colors.labelMember);
    if (diagramLabelsVisible) this.drawDiagramLabels(options, colors.labelBackground, colors.labelDiagram);
  }

  private drawLoadCaption(caption: string, background: string, color: string): void {
    if (!caption) return;
    const lines: string[] = [];
    const maxWidth = Math.max(40, this.cssWidth - 24);
    let line = '';
    for (const character of caption.replace(/\s+/g, ' ')) {
      if (line && this.context.measureText(line + character).width > maxWidth) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
    if (line) lines.push(line);
    const top = this.cssHeight - 10 - lines.length * 15;
    this.context.save();
    this.context.textAlign = 'left';
    this.context.textBaseline = 'top';
    this.context.fillStyle = background;
    this.context.fillRect(6, top - 4, this.cssWidth - 12, lines.length * 15 + 8);
    this.context.fillStyle = color;
    lines.forEach((text, index) => this.context.fillText(text, 12, top + index * 15));
    this.context.restore();
    this.occupied.push({ left: 6, right: this.cssWidth - 6, top: top - 4, bottom: this.cssHeight - 6 });
  }

  private drawSupportLabels(options: LabelDrawOptions, background: string, color: string): void {
    this.context.save();
    this.context.textAlign = 'center';
    this.context.textBaseline = 'top';
    for (const support of options.supports) {
      const selected = options.selectedNodeIds.has(support.node.id);
      if (options.labelMode === 'selected' && !selected) continue;
      const screen = projectToScreen(new THREE.Vector3(support.node.x, support.node.y, support.node.z), options.camera, this.cssWidth, this.cssHeight);
      // Only clamp labels for visible supports; an offscreen support must not
      // leave a detached label at the edge or hide another support's label.
      if (!screen || screen.x < 0 || screen.x > this.cssWidth || screen.y < 0 || screen.y > this.cssHeight) continue;
      const lines: string[] = [];
      let current = '';
      const maxWidth = Math.min(300, Math.max(40, this.cssWidth - 24));
      for (const part of support.label.split(' · ')) {
        if (current && this.context.measureText(`${current} · ${part}`).width > maxWidth) {
          lines.push(current);
          current = '';
        }
        current = current ? `${current} · ${part}` : part;
      }
      if (current) lines.push(current);
      const width = Math.max(...lines.map((line) => this.context.measureText(line).width)) + 8;
      const x = Math.max(width / 2 + 4, Math.min(screen.x, this.cssWidth - width / 2 - 4));
      const y = screen.y + 25;
      const height = lines.length * 15;
      if (!this.claimRectangle({ left: x - width / 2, right: x + width / 2, top: y, bottom: y + height }, options.labelMode === 'all' || selected)) continue;
      this.context.fillStyle = background;
      this.context.fillRect(x - width / 2, y, width, height);
      this.context.fillStyle = color;
      lines.forEach((line, index) => this.context.fillText(line, x, y + 1 + index * 15));
    }
    this.context.restore();
  }

  private drawNodeLabels(options: LabelDrawOptions, color: string): void {
    const model = options.model;
    if (!model) return;
    this.context.fillStyle = color;
    const selected = model.nodes.filter((node) => options.selectedNodeIds.has(node.id));
    const remaining = model.nodes.filter((node) => !options.selectedNodeIds.has(node.id));
    const candidates = options.labelMode === 'selected' ? selected : [...selected, ...remaining];
    const world = new THREE.Vector3();
    for (const node of candidates) {
      world.set(node.x, node.y, node.z);
      const screen = projectToScreen(world, options.camera, this.cssWidth, this.cssHeight);
      if (!screen) continue;
      const text = nodeLabel(node);
      const force = options.labelMode === 'all' || options.selectedNodeIds.has(node.id);
      if (!this.claimText(screen.x, screen.y - 6, text, force)) continue;
      this.context.fillText(text, screen.x, screen.y - 6);
    }
  }

  private drawMemberLabels(options: LabelDrawOptions, color: string): void {
    const model = options.model;
    if (!model) return;
    const nodeMap = new Map(model.nodes.map((node) => [node.id, node]));
    this.context.fillStyle = color;
    const selected = model.members.filter((member) => options.selectedMemberIds.has(member.id));
    const remaining = model.members.filter((member) => !options.selectedMemberIds.has(member.id));
    const candidates = options.labelMode === 'selected' ? selected : [...selected, ...remaining];
    const world = new THREE.Vector3();
    for (const member of candidates) {
      const nodeI = nodeMap.get(member.ni);
      const nodeJ = nodeMap.get(member.nj);
      if (!nodeI || !nodeJ) continue;
      world.set(
        (nodeI.x + nodeJ.x) / 2,
        (nodeI.y + nodeJ.y) / 2,
        (nodeI.z + nodeJ.z) / 2,
      );
      const screen = projectToScreen(world, options.camera, this.cssWidth, this.cssHeight);
      if (!screen) continue;
      const text = memberLabel(member);
      const force = options.labelMode === 'all' || options.selectedMemberIds.has(member.id);
      if (!this.claimText(screen.x, screen.y - 4, text, force)) continue;
      this.context.fillText(text, screen.x, screen.y - 4);
    }
  }

  private drawDiagramLabels(
    options: LabelDrawOptions,
    backgroundColor: string,
    textColor: string,
  ): void {
    const model = options.model;
    const result = options.result;
    if (!model || !result) return;
    this.context.textAlign = 'left';
    this.context.textBaseline = 'middle';

    const selected = model.members.filter((member) => options.selectedMemberIds.has(member.id));
    const remaining = model.members.filter((member) => !options.selectedMemberIds.has(member.id));
    const candidates = options.labelMode === 'selected' ? selected : [...selected, ...remaining];
    for (const member of candidates) {
      const points = result.diagrams[member.id]?.points;
      if (!points || points.length === 0) continue;
      const maximum = this.findMaximumPoint(points, options.displayMode);
      if (!maximum || Math.abs(maximum.value) < 1e-10) continue;
      const world = getDiagramLabelPosition(
        model,
        member.id,
        maximum.point,
        options.displayMode,
        options.diagramScale,
      );
      if (!world) continue;
      const screen = projectToScreen(world, options.camera, this.cssWidth, this.cssHeight);
      if (!screen) continue;

      const text = `${options.displayMode} ${formatEngineering(maximum.value)}`;
      const width = this.context.measureText(text).width + 8;
      const height = 16;
      const x = screen.x + 6;
      const y = screen.y - 6;
      const force = options.labelMode === 'all' || options.selectedMemberIds.has(member.id);
      if (!this.claimRectangle({ left: x - 4, top: y - height / 2, right: x - 4 + width, bottom: y + height / 2 }, force)) continue;
      this.context.fillStyle = backgroundColor;
      this.context.fillRect(x - 4, y - height / 2, width, height);
      this.context.fillStyle = textColor;
      this.context.fillText(text, x, y);
    }
  }

  private findMaximumPoint(
    points: DiagramPoint[],
    mode: DisplayMode,
  ): { point: DiagramPoint; value: number } | null {
    let maximum: { point: DiagramPoint; value: number } | null = null;
    for (const point of points) {
      const value = getDiagramValue(point, mode);
      if (!maximum || Math.abs(value) > Math.abs(maximum.value)) maximum = { point, value };
    }
    return maximum;
  }

  private claimText(x: number, y: number, text: string, force: boolean): boolean {
    const width = this.context.measureText(text).width + 8;
    const height = 15;
    return this.claimRectangle({
      left: x - width / 2,
      top: y - height,
      right: x + width / 2,
      bottom: y,
    }, force);
  }

  private claimRectangle(rectangle: LabelRectangle, force: boolean): boolean {
    if (!force) {
      const overlaps = this.occupied.some((item) => !(
        rectangle.right + 3 < item.left
        || rectangle.left - 3 > item.right
        || rectangle.bottom + 3 < item.top
        || rectangle.top - 3 > item.bottom
      ));
      if (overlaps) return false;
    }
    this.occupied.push(rectangle);
    return true;
  }

  drawOnto(target: CanvasRenderingContext2D): void {
    target.drawImage(this.canvas, 0, 0);
  }

  dispose(): void {
    this.canvas.remove();
  }
}
