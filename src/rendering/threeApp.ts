import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ProjectModel, DiagramPoint } from '../core/model/types';
import type { AnalysisResult } from '../state/projectStore';
import type { DisplayMode, EditTool, Theme } from '../state/viewStore';

const CAMERA_FOV = 45;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 100000;

const THEME_COLORS = {
  light: {
    background: 0xf0f0f0,
    gridCenter: 0xcccccc,
    gridLine: 0xeeeeee,
    labelNode: '#0044aa',
    labelMember: '#aa4400',
  },
  dark: {
    background: 0x252535,
    gridCenter: 0x3a3a4a,
    gridLine: 0x333344,
    labelNode: '#66aaff',
    labelMember: '#ffaa66',
  },
} as const;

const NODE_POINT_SIZE = 8;
const NODE_COLOR = new THREE.Color(0, 0.3, 0.8);
const NODE_COLOR_SELECTED = new THREE.Color(1, 0, 0);
const MEMBER_COLOR = new THREE.Color(0, 0.3, 0.8);
const MEMBER_COLOR_SELECTED = new THREE.Color(1, 0, 0);
const DEFORM_COLOR = new THREE.Color(0.0, 0.8, 0.3);
const DIAGRAM_COLOR_POS = new THREE.Color(1, 0.2, 0.2);
const DIAGRAM_COLOR_NEG = new THREE.Color(0.2, 0.4, 1);
const SUPPORT_COLOR = 0x00aa00;
const SUPPORT_OPACITY = 0.6;
const SUPPORT_SIZE = 8;

const LABEL_FONT = '11px sans-serif';
const CLICK_DRAG_THRESHOLD = 4;
const NODE_PICK_RADIUS = 10;
const MEMBER_PICK_RADIUS = 8;

export type ViewerSelection =
  | { kind: 'none' }
  | { kind: 'node'; nodeId: string }
  | { kind: 'member'; memberId: string };

export type EditAction =
  | { kind: 'addNode'; x: number; y: number; z: number }
  | { kind: 'addMember'; ni: string; nj: string }
  | { kind: 'setSupport'; nodeId: string }
  | { kind: 'addNodalLoad'; nodeId: string }
  | { kind: 'addMemberLoad'; memberId: string }
  | { kind: 'moveNode'; nodeId: string; x: number; y: number; z: number }
  | { kind: 'deleteSelected' }
  | { kind: 'cancelOperation' };

export class ThreeApp {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private container: HTMLElement;

  private nodeGroup = new THREE.Group();
  private memberGroup = new THREE.Group();
  private resultGroup = new THREE.Group();
  private supportGroup = new THREE.Group();
  private loadGroup = new THREE.Group();

  private grid!: THREE.GridHelper;

  private labelCanvas: HTMLCanvasElement;
  private labelCtx: CanvasRenderingContext2D;
  private animationId = 0;
  private onResizeBound: () => void;
  private pointerDownPos: { x: number; y: number } | null = null;
  private draggingNodeId: string | null = null;
  private draggingNodeZ = 0;
  private isDragging = false;

  private model: ProjectModel | null = null;
  private result: AnalysisResult | null = null;
  private displayMode: DisplayMode = 'model';
  private deformationScale = 50;
  private diagramScale = 1;
  private selectedNodeIds: ReadonlySet<string> = new Set();
  private selectedMemberIds: ReadonlySet<string> = new Set();
  private isDark = false;
  private showNodeLabels = true;
  private showMemberLabels = true;
  private editTool: EditTool = 'select';
  private pendingMemberStart: string | null = null;

  onSelectionChanged: ((sel: ViewerSelection, multi: boolean) => void) | null = null;
  onEditAction: ((action: EditAction) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(THEME_COLORS.dark.background);

    const aspect = container.clientWidth / container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
    this.camera.position.set(500, -1000, 800);
    this.camera.up.set(0, 0, 1);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    this.labelCanvas.width = container.clientWidth;
    this.labelCanvas.height = container.clientHeight;
    container.appendChild(this.labelCanvas);
    this.labelCtx = this.labelCanvas.getContext('2d')!;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = true;

    this.scene.add(this.nodeGroup);
    this.scene.add(this.memberGroup);
    this.scene.add(this.resultGroup);
    this.scene.add(this.supportGroup);
    this.scene.add(this.loadGroup);

    this.createGrid();
    this.scene.add(new THREE.AxesHelper(200));

    this.onResizeBound = () => this.onResize();
    window.addEventListener('resize', this.onResizeBound);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);

    this.animate();
  }

  private createGrid(): void {
    const colors = this.isDark ? THEME_COLORS.dark : THEME_COLORS.light;
    this.grid = new THREE.GridHelper(2000, 20, colors.gridCenter, colors.gridLine);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.drawLabels();
  };

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelCanvas.width = w;
    this.labelCanvas.height = h;
  }

  resize(): void {
    this.onResize();
  }

  setTheme(theme: Theme): void {
    this.isDark = theme === 'dark';
    const colors = this.isDark ? THEME_COLORS.dark : THEME_COLORS.light;
    (this.scene.background as THREE.Color).set(colors.background);

    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.createGrid();
  }

  setModel(model: ProjectModel): void {
    this.model = model;
    this.rebuildNodes();
    this.rebuildMembers();
    this.rebuildSupports();
    this.rebuildLoads();
    this.rebuildResults();
  }

  setResult(result: AnalysisResult | null): void {
    this.result = result;
    this.rebuildResults();
  }

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.rebuildResults();
  }

  setDeformationScale(scale: number): void {
    this.deformationScale = scale;
    this.rebuildResults();
  }

  setDiagramScale(scale: number): void {
    this.diagramScale = scale;
    this.rebuildResults();
  }

  setShowNodeLabels(v: boolean): void { this.showNodeLabels = v; }
  setShowMemberLabels(v: boolean): void { this.showMemberLabels = v; }
  setShowLoads(v: boolean): void { this.loadGroup.visible = v; }
  setShowSupports(v: boolean): void { this.supportGroup.visible = v; }

  setEditTool(tool: EditTool): void {
    this.editTool = tool;
    if (tool !== 'addMember') this.pendingMemberStart = null;
  }

  setSelectedIds(nodeIds: ReadonlySet<string>, memberIds: ReadonlySet<string>): void {
    this.selectedNodeIds = nodeIds;
    this.selectedMemberIds = memberIds;
    this.rebuildNodes();
    this.rebuildMembers();
  }

  fitToView(): void {
    if (!this.model || this.model.nodes.length === 0) return;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const n of this.model.nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      minZ = Math.min(minZ, n.z); maxZ = Math.max(maxZ, n.z);
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 100);

    this.controls.target.set(cx, cy, cz);
    this.camera.position.set(cx + maxDim, cy - maxDim * 1.2, cz + maxDim * 0.8);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0]!;
      group.remove(child);
      this.disposeObject(child);
    }
  }

  private disposeObject(obj: THREE.Object3D): void {
    // Recurse into children first (e.g. ArrowHelper contains line + cone)
    while (obj.children.length > 0) {
      const child = obj.children[0]!;
      obj.remove(child);
      this.disposeObject(child);
    }
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.LineSegments || obj instanceof THREE.Line) {
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat.dispose();
    }
  }

  private rebuildNodes(): void {
    this.clearGroup(this.nodeGroup);
    if (!this.model) return;

    const positions: number[] = [];
    const colors: number[] = [];
    for (const n of this.model.nodes) {
      positions.push(n.x, n.y, n.z);
      const c = this.selectedNodeIds.has(n.id) ? NODE_COLOR_SELECTED : NODE_COLOR;
      colors.push(c.r, c.g, c.b);
    }
    if (positions.length === 0) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({ size: NODE_POINT_SIZE, sizeAttenuation: false, vertexColors: true });
    this.nodeGroup.add(new THREE.Points(geo, mat));
  }

  private rebuildMembers(): void {
    this.clearGroup(this.memberGroup);
    if (!this.model) return;

    const nodeMap = new Map(this.model.nodes.map(n => [n.id, n]));
    const positions: number[] = [];
    const colors: number[] = [];

    for (const m of this.model.members) {
      const ni = nodeMap.get(m.ni);
      const nj = nodeMap.get(m.nj);
      if (!ni || !nj) continue;
      positions.push(ni.x, ni.y, ni.z, nj.x, nj.y, nj.z);
      const c = this.selectedMemberIds.has(m.id) ? MEMBER_COLOR_SELECTED : MEMBER_COLOR;
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    if (positions.length === 0) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true });
    this.memberGroup.add(new THREE.LineSegments(geo, mat));
  }

  private rebuildSupports(): void {
    this.clearGroup(this.supportGroup);
    if (!this.model) return;

    for (const n of this.model.nodes) {
      const r = n.restraint;
      if (!r.ux && !r.uy && !r.uz) continue;

      const triGeo = new THREE.BufferGeometry();
      const s = SUPPORT_SIZE;
      triGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        n.x, n.y, n.z - s,
        n.x - s * 0.7, n.y, n.z - s * 2,
        n.x + s * 0.7, n.y, n.z - s * 2,
      ], 3));
      triGeo.setIndex([0, 1, 2]);
      const triMat = new THREE.MeshBasicMaterial({
        color: SUPPORT_COLOR,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: SUPPORT_OPACITY,
      });
      this.supportGroup.add(new THREE.Mesh(triGeo, triMat));
    }
  }

  /**
   * Compute local axes for a member, matching indexing.ts computeLambda.
   * Returns { lx, ly, lz } as THREE.Vector3 in global coords.
   */
  private computeMemberLocalAxes(
    ni: { x: number; y: number; z: number },
    nj: { x: number; y: number; z: number },
    codeAngle: number
  ): { lx: THREE.Vector3; ly: THREE.Vector3; lz: THREE.Vector3 } {
    const dx = nj.x - ni.x, dy = nj.y - ni.y, dz = nj.z - ni.z;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const lx = new THREE.Vector3(dx / L, dy / L, dz / L);

    const isVertical = Math.abs(lx.z) > 0.95;
    const ref = isVertical ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);

    const ly = new THREE.Vector3().crossVectors(ref, lx).normalize();
    const lz = new THREE.Vector3().crossVectors(lx, ly).normalize();

    if (codeAngle !== 0) {
      const theta = codeAngle * Math.PI / 180;
      const cosT = Math.cos(theta), sinT = Math.sin(theta);
      const ly2 = ly.clone().multiplyScalar(cosT).add(lz.clone().multiplyScalar(sinT));
      const lz2 = ly.clone().multiplyScalar(-sinT).add(lz.clone().multiplyScalar(cosT));
      return { lx, ly: ly2, lz: lz2 };
    }
    return { lx, ly, lz };
  }

  private rebuildLoads(): void {
    this.clearGroup(this.loadGroup);
    if (!this.model) return;

    const FORCE_COLOR = 0xff4444;
    const MOMENT_COLOR = 0xee8800;
    const ARROW_LEN = 15;
    const HEAD_LEN = 4;
    const HEAD_WIDTH = 2;

    const nodeMap = new Map(this.model.nodes.map(n => [n.id, n]));

    const addArrow = (origin: THREE.Vector3, dir: THREE.Vector3, len: number, color: number) => {
      const start = origin.clone().add(dir.clone().multiplyScalar(-len));
      this.loadGroup.add(new THREE.ArrowHelper(dir, start, len, color, HEAD_LEN, HEAD_WIDTH));
    };

    // ── Nodal loads: forces + moments ──
    for (const nl of this.model.nodalLoads) {
      const node = nodeMap.get(nl.nodeId);
      if (!node) continue;
      const o = new THREE.Vector3(node.x, node.y, node.z);

      // Forces
      const forces: [number, THREE.Vector3][] = [
        [nl.fx, new THREE.Vector3(1, 0, 0)],
        [nl.fy, new THREE.Vector3(0, 1, 0)],
        [nl.fz, new THREE.Vector3(0, 0, 1)],
      ];
      for (const [v, dir] of forces) {
        if (Math.abs(v) < 1e-10) continue;
        addArrow(o, dir.multiplyScalar(v > 0 ? 1 : -1), ARROW_LEN, FORCE_COLOR);
      }

      // Moments (double-headed arc approximated as curved arrow symbol)
      const moments: [number, THREE.Vector3][] = [
        [nl.mx, new THREE.Vector3(1, 0, 0)],
        [nl.my, new THREE.Vector3(0, 1, 0)],
        [nl.mz, new THREE.Vector3(0, 0, 1)],
      ];
      for (const [v, axis] of moments) {
        if (Math.abs(v) < 1e-10) continue;
        // Draw a double arrow perpendicular to the axis to indicate moment
        const perp = Math.abs(axis.z) > 0.9
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, 0, 1);
        const arm = new THREE.Vector3().crossVectors(axis, perp).normalize();
        const sign = v > 0 ? 1 : -1;
        const tipDir = new THREE.Vector3().crossVectors(arm, axis).normalize().multiplyScalar(sign);
        const armOffset = o.clone().add(arm.clone().multiplyScalar(ARROW_LEN * 0.5));
        addArrow(armOffset, tipDir, ARROW_LEN * 0.5, MOMENT_COLOR);
        const armOffset2 = o.clone().add(arm.clone().multiplyScalar(-ARROW_LEN * 0.5));
        addArrow(armOffset2, tipDir.clone().negate(), ARROW_LEN * 0.5, MOMENT_COLOR);
      }
    }

    // ── Member loads ──
    const memberMap = new Map(this.model.members.map(m => [m.id, m]));

    for (const ml of this.model.memberLoads) {
      const member = memberMap.get(ml.memberId);
      if (!member) continue;
      const ni = nodeMap.get(member.ni);
      const nj = nodeMap.get(member.nj);
      if (!ni || !nj) continue;

      const pI = new THREE.Vector3(ni.x, ni.y, ni.z);
      const pJ = new THREE.Vector3(nj.x, nj.y, nj.z);
      const { lx, ly, lz } = this.computeMemberLocalAxes(ni, nj, member.codeAngle);

      const localDir = (dir: string): THREE.Vector3 => {
        if (dir === 'localX') return lx.clone();
        if (dir === 'localZ') return lz.clone();
        return ly.clone();
      };

      if (ml.type === 'udl') {
        const dir = localDir(ml.direction).multiplyScalar(ml.value > 0 ? 1 : -1);
        const NSEG = 5;
        for (let i = 0; i <= NSEG; i++) {
          const pos = pI.clone().lerp(pJ.clone(), i / NSEG);
          addArrow(pos, dir, ARROW_LEN * 0.6, FORCE_COLOR);
        }
      } else if (ml.type === 'point') {
        const L = pI.distanceTo(pJ);
        const t = L > 0 ? ml.a / L : 0;
        const pos = pI.clone().lerp(pJ.clone(), t);
        const dir = localDir(ml.direction).multiplyScalar(ml.value > 0 ? 1 : -1);
        addArrow(pos, dir, ARROW_LEN, FORCE_COLOR);
      } else if (ml.type === 'cmq') {
        // CMQ: show force arrows at i-end and j-end
        const cmqForces: [THREE.Vector3, [number, number, number]][] = [
          [pI, [ml.iQx, ml.iQy, ml.iQz]],
          [pJ, [ml.jQx, ml.jQy, ml.jQz]],
        ];
        for (const [pos, [qx, qy, qz]] of cmqForces) {
          if (Math.abs(qx) > 1e-10) addArrow(pos, lx.clone().multiplyScalar(qx > 0 ? 1 : -1), ARROW_LEN * 0.5, FORCE_COLOR);
          if (Math.abs(qy) > 1e-10) addArrow(pos, ly.clone().multiplyScalar(qy > 0 ? 1 : -1), ARROW_LEN * 0.5, FORCE_COLOR);
          if (Math.abs(qz) > 1e-10) addArrow(pos, lz.clone().multiplyScalar(qz > 0 ? 1 : -1), ARROW_LEN * 0.5, FORCE_COLOR);
        }
      }
    }
  }

  private rebuildResults(): void {
    this.clearGroup(this.resultGroup);
    if (!this.model || !this.result) return;

    if (this.displayMode === 'deformation') {
      this.drawDeformedShape();
    } else if (this.displayMode !== 'model') {
      this.drawDiagrams();
    }
  }

  private drawDeformedShape(): void {
    if (!this.model || !this.result) return;

    const nodeMap = new Map(this.model.nodes.map(n => [n.id, n]));
    const nodeIdToIndex = new Map(this.model.nodes.map((n, i) => [n.id, i]));
    const d = this.result.displacements;
    const scale = this.deformationScale;
    const positions: number[] = [];

    for (const m of this.model.members) {
      const ni = nodeMap.get(m.ni);
      const nj = nodeMap.get(m.nj);
      if (!ni || !nj) continue;
      const ii = nodeIdToIndex.get(m.ni)!;
      const ij = nodeIdToIndex.get(m.nj)!;

      positions.push(
        ni.x + (d[ii * 6] ?? 0) * scale,
        ni.y + (d[ii * 6 + 1] ?? 0) * scale,
        ni.z + (d[ii * 6 + 2] ?? 0) * scale,
        nj.x + (d[ij * 6] ?? 0) * scale,
        nj.y + (d[ij * 6 + 1] ?? 0) * scale,
        nj.z + (d[ij * 6 + 2] ?? 0) * scale,
      );
    }

    if (positions.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: DEFORM_COLOR });
    this.resultGroup.add(new THREE.LineSegments(geo, mat));
  }

  private drawDiagrams(): void {
    if (!this.model || !this.result) return;

    const nodeMap = new Map(this.model.nodes.map(n => [n.id, n]));
    const mode = this.displayMode;
    const scale = this.diagramScale;

    for (const m of this.model.members) {
      const ni = nodeMap.get(m.ni);
      const nj = nodeMap.get(m.nj);
      if (!ni || !nj) continue;

      const diagData = this.result.diagrams[m.id];
      if (!diagData) continue;
      const pts = diagData.points;
      if (pts.length < 2) continue;

      // Member direction
      const dx = nj.x - ni.x;
      const dy = nj.y - ni.y;
      const dz = nj.z - ni.z;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-10) continue;

      const lx = dx / L, ly = dy / L, lz = dz / L;

      // Perpendicular direction for diagram offset (approximate: use Z-up cross product)
      let px: number, py: number, pz: number;
      if (Math.abs(lz) > 0.95) {
        // Nearly vertical: use Y direction
        px = 0; py = 1; pz = 0;
      } else {
        // Cross with Z-up
        const cx = ly * 1 - lz * 0;
        const cy = lz * 0 - lx * 1;
        const cz = lx * 0 - ly * 0;
        const cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
        px = cx / cl; py = cy / cl; pz = cz / cl;
      }

      const getValue = (p: DiagramPoint): number => {
        switch (mode) {
          case 'N': return p.N;
          case 'Vy': return p.Vy;
          case 'Vz': return p.Vz;
          case 'Mx': return p.Mx;
          case 'My': return p.My;
          case 'Mz': return p.Mz;
          default: return 0;
        }
      };

      // Build ribbon (line strip of offset positions)
      const ribbonPositions: number[] = [];
      const ribbonColors: number[] = [];

      for (const p of pts) {
        const t = L > 0 ? p.x / L : 0;
        const bx = ni.x + dx * t;
        const by = ni.y + dy * t;
        const bz = ni.z + dz * t;

        const val = getValue(p);
        const offset = val * scale;

        ribbonPositions.push(
          bx + px * offset,
          by + py * offset,
          bz + pz * offset,
        );

        const c = val >= 0 ? DIAGRAM_COLOR_POS : DIAGRAM_COLOR_NEG;
        ribbonColors.push(c.r, c.g, c.b);
      }

      if (ribbonPositions.length >= 6) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(ribbonPositions, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(ribbonColors, 3));
        const mat = new THREE.LineBasicMaterial({ vertexColors: true });
        this.resultGroup.add(new THREE.Line(geo, mat));
      }

      // Base line (member axis for reference)
      const baseGeo = new THREE.BufferGeometry();
      baseGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        ni.x, ni.y, ni.z, nj.x, nj.y, nj.z
      ], 3));
      const baseMat = new THREE.LineBasicMaterial({ color: 0x666666 });
      this.resultGroup.add(new THREE.LineSegments(baseGeo, baseMat));
    }
  }

  // ── Labels ──

  private projectToScreen(pos: THREE.Vector3, tmp: THREE.Vector3): { x: number; y: number } | null {
    tmp.copy(pos).project(this.camera);
    if (tmp.z <= 0 || tmp.z >= 1) return null;
    return {
      x: (tmp.x * 0.5 + 0.5) * this.labelCanvas.width,
      y: (-tmp.y * 0.5 + 0.5) * this.labelCanvas.height,
    };
  }

  private drawLabels(): void {
    this.labelCtx.clearRect(0, 0, this.labelCanvas.width, this.labelCanvas.height);
    if (!this.model) return;
    if (!this.showNodeLabels && !this.showMemberLabels) return;

    this.labelCtx.font = LABEL_FONT;
    this.labelCtx.textAlign = 'center';
    this.labelCtx.textBaseline = 'bottom';

    const tmp = new THREE.Vector3();
    const wp = new THREE.Vector3();
    const colors = this.isDark ? THEME_COLORS.dark : THEME_COLORS.light;

    if (this.showNodeLabels) {
      this.labelCtx.fillStyle = colors.labelNode;
      for (const n of this.model.nodes) {
        wp.set(n.x, n.y, n.z);
        const s = this.projectToScreen(wp, tmp);
        if (s) this.labelCtx.fillText(n.id, s.x, s.y - 6);
      }
    }

    if (this.showMemberLabels) {
      this.labelCtx.fillStyle = colors.labelMember;
      const nodeMap = new Map(this.model.nodes.map(n => [n.id, n]));
      for (const m of this.model.members) {
        const ni = nodeMap.get(m.ni);
        const nj = nodeMap.get(m.nj);
        if (!ni || !nj) continue;
        wp.set((ni.x + nj.x) / 2, (ni.y + nj.y) / 2, (ni.z + nj.z) / 2);
        const s = this.projectToScreen(wp, tmp);
        if (s) this.labelCtx.fillText(m.id, s.x, s.y - 4);
      }
    }
  }

  // ── Picking ──

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.isDragging = false;

    // Start drag if select tool and a node is under the pointer
    if (this.editTool === 'select' && this.model) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const hit = this.pickNode(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) {
        this.draggingNodeId = hit.nodeId;
        const node = this.model.nodes.find(n => n.id === hit.nodeId);
        this.draggingNodeZ = node?.z ?? 0;
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointerDownPos || !this.draggingNodeId) return;
    const dx = e.clientX - this.pointerDownPos.x;
    const dy = e.clientY - this.pointerDownPos.y;
    if (!this.isDragging && dx * dx + dy * dy > CLICK_DRAG_THRESHOLD * CLICK_DRAG_THRESHOLD) {
      this.isDragging = true;
      this.controls.enabled = false; // disable orbit while dragging node
    }
    if (!this.isDragging) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const pos = this.screenToPlane(e.clientX - rect.left, e.clientY - rect.top, this.draggingNodeZ);
    if (pos) {
      this.onEditAction?.({ kind: 'moveNode', nodeId: this.draggingNodeId, x: pos.x, y: pos.y, z: pos.z });
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.pointerDownPos) return;

    const wasDragging = this.isDragging;
    this.pointerDownPos = null;
    this.draggingNodeId = null;
    this.isDragging = false;
    this.controls.enabled = true;

    if (wasDragging) return; // drag completed, don't fire click

    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.handleClick(x, y, e.shiftKey);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    // Ignore shortcuts when focus is inside a form element
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (e.target as HTMLElement)?.isContentEditable) {
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.onEditAction?.({ kind: 'deleteSelected' });
    } else if (e.key === 'Escape') {
      this.pendingMemberStart = null;
      this.onEditAction?.({ kind: 'cancelOperation' });
    }
  };

  private handleClick(x: number, y: number, shift = false): void {
    if (!this.model) return;

    switch (this.editTool) {
      case 'addNode':
        return this.handleAddNode(x, y);
      case 'addMember':
        return this.handleAddMember(x, y);
      case 'setSupport':
        return this.handleSetSupport(x, y);
      case 'addNodalLoad':
        return this.handleAddNodalLoad(x, y);
      case 'addMemberLoad':
        return this.handleAddMemberLoad(x, y);
      default:
        return this.handleSelect(x, y, shift);
    }
  }

  private handleSelect(x: number, y: number, multi = false): void {
    const nodeHit = this.pickNode(x, y);
    const memberHit = this.pickMember(x, y);

    if (nodeHit && memberHit) {
      const ns = nodeHit.distSq / (NODE_PICK_RADIUS * NODE_PICK_RADIUS);
      const ms = memberHit.distSq / (MEMBER_PICK_RADIUS * MEMBER_PICK_RADIUS);
      const sel = ns <= ms
        ? { kind: 'node' as const, nodeId: nodeHit.nodeId }
        : { kind: 'member' as const, memberId: memberHit.memberId };
      this.onSelectionChanged?.(sel, multi);
      return;
    }
    if (nodeHit) {
      this.onSelectionChanged?.({ kind: 'node', nodeId: nodeHit.nodeId }, multi);
      return;
    }
    if (memberHit) {
      this.onSelectionChanged?.({ kind: 'member', memberId: memberHit.memberId }, multi);
      return;
    }
    if (!multi) {
      this.onSelectionChanged?.({ kind: 'none' }, false);
    }
  }

  /** Raycast from screen (x,y) to a Z-plane at given height, returning world coords. */
  private screenToPlane(x: number, y: number, planeZ = 0): { x: number; y: number; z: number } | null {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const ndcX = (x / w) * 2 - 1;
    const ndcY = -(y / h) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
    const target = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, target);
    if (!hit) return null;
    return { x: Math.round(target.x), y: Math.round(target.y), z: planeZ };
  }

  private handleAddNode(x: number, y: number): void {
    const pos = this.screenToPlane(x, y);
    if (!pos) return;
    this.onEditAction?.({ kind: 'addNode', x: pos.x, y: pos.y, z: pos.z });
  }

  private handleAddMember(x: number, y: number): void {
    const nodeHit = this.pickNode(x, y);
    if (!nodeHit) return;
    if (!this.pendingMemberStart) {
      this.pendingMemberStart = nodeHit.nodeId;
      this.onSelectionChanged?.({ kind: 'node', nodeId: nodeHit.nodeId }, false);
    } else {
      if (nodeHit.nodeId !== this.pendingMemberStart) {
        this.onEditAction?.({ kind: 'addMember', ni: this.pendingMemberStart, nj: nodeHit.nodeId });
      }
      this.pendingMemberStart = null;
    }
  }

  private handleSetSupport(x: number, y: number): void {
    const nodeHit = this.pickNode(x, y);
    if (!nodeHit) return;
    this.onEditAction?.({ kind: 'setSupport', nodeId: nodeHit.nodeId });
  }

  private handleAddNodalLoad(x: number, y: number): void {
    const nodeHit = this.pickNode(x, y);
    if (!nodeHit) return;
    this.onEditAction?.({ kind: 'addNodalLoad', nodeId: nodeHit.nodeId });
  }

  private handleAddMemberLoad(x: number, y: number): void {
    const memberHit = this.pickMember(x, y);
    if (!memberHit) return;
    this.onEditAction?.({ kind: 'addMemberLoad', memberId: memberHit.memberId });
  }

  private pickNode(x: number, y: number): { nodeId: string; distSq: number } | null {
    if (!this.model) return null;
    const tmp = new THREE.Vector3();
    const wp = new THREE.Vector3();
    let best: { nodeId: string; distSq: number } | null = null;
    const rSq = NODE_PICK_RADIUS * NODE_PICK_RADIUS;

    for (const n of this.model.nodes) {
      wp.set(n.x, n.y, n.z);
      const s = this.projectToScreen(wp, tmp);
      if (!s) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d > rSq) continue;
      if (!best || d < best.distSq) best = { nodeId: n.id, distSq: d };
    }
    return best;
  }

  private pickMember(x: number, y: number): { memberId: string; distSq: number } | null {
    if (!this.model) return null;
    const nodeMap = new Map(this.model.nodes.map(n => [n.id, n]));
    const tmp = new THREE.Vector3();
    const wp = new THREE.Vector3();
    let best: { memberId: string; distSq: number } | null = null;
    const rSq = MEMBER_PICK_RADIUS * MEMBER_PICK_RADIUS;

    for (const m of this.model.members) {
      const ni = nodeMap.get(m.ni);
      const nj = nodeMap.get(m.nj);
      if (!ni || !nj) continue;

      wp.set(ni.x, ni.y, ni.z);
      const a = this.projectToScreen(wp, tmp);
      wp.set(nj.x, nj.y, nj.z);
      const b = this.projectToScreen(wp, tmp);
      if (!a || !b) continue;

      const d = pointToSegmentDistSq(x, y, a.x, a.y, b.x, b.y);
      if (d > rSq) continue;
      if (!best || d < best.distSq) best = { memberId: m.id, distSq: d };
    }
    return best;
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResizeBound);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    this.clearGroup(this.nodeGroup);
    this.clearGroup(this.memberGroup);
    this.clearGroup(this.resultGroup);
    this.clearGroup(this.supportGroup);
    this.clearGroup(this.loadGroup);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelCanvas.remove();
  }
}

function pointToSegmentDistSq(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number
): number {
  const abx = bx - ax, aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 1e-8) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  return (px - ax - t * abx) ** 2 + (py - ay - t * aby) ** 2;
}
