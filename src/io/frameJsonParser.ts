import type { FrameJsonDocument } from './frameJsonTypes';

type JsonObject = Record<string, unknown>;

export class FrameJsonValidationError extends Error {
  constructor(public readonly path: string, public readonly value: unknown, expectation: string) {
    const original = typeof value === 'number' && !Number.isFinite(value)
      ? String(value) : JSON.stringify(value) ?? String(value);
    super(`Invalid FrameJson: ${path} ${expectation}; received ${original}.`);
    this.name = 'FrameJsonValidationError';
  }
}

function asObject(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FrameJsonValidationError(path, value, 'must be an object');
  }
  return value as JsonObject;
}

function asArray(value: unknown, path: string, optional = true): unknown[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) throw new FrameJsonValidationError(path, value, 'must be an array');
  return value;
}

// Decimal and scientific notation strings are accepted for interoperability.
// Empty strings, null, booleans, containers and hexadecimal strings are invalid.
function toNumber(value: unknown, path: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  const n = typeof value === 'number' ? value
    : typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
      ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) throw new FrameJsonValidationError(path, value, 'must be a finite decimal number');
  return n;
}

function toInt(value: unknown, path: string, fallback?: number): number {
  const n = toNumber(value, path, fallback);
  if (!Number.isSafeInteger(n)) throw new FrameJsonValidationError(path, value, 'must be a safe integer');
  return n;
}

function toString_(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

/**
 * Parse JSON text once and preserve the original value for format detection.
 */
export function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Convert an already-parsed value into a FrameJsonDocument with strict numeric
 * validation. Keeping this separate from text parsing avoids parsing the same
 * import twice during automatic format detection.
 */
export function parseFrameJson(parsed: unknown): FrameJsonDocument {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON: root must be an object');
  }

  const raw = parsed as JsonObject;

  return {
    title: toString_(raw.title),
    loadCaseCount: Math.max(1, toInt(raw.loadCaseCount, 'loadCaseCount', 1)),
    loadCaseIndex: Math.max(0, toInt(raw.loadCaseIndex, 'loadCaseIndex', 0)),
    calcCaseMemo: asArray(raw.calcCaseMemo, 'calcCaseMemo').map(toString_),

    nodes: asArray(raw.nodes, 'nodes', false).map((v, index) => {
      const path = `nodes[${index}]`;
      const o = asObject(v, path);
      return {
        number: toInt(o.number, `${path}.number`),
        x: toNumber(o.x, `${path}.x`),
        y: toNumber(o.y, `${path}.y`),
        z: toNumber(o.z, `${path}.z`),
        temperature: toNumber(o.temperature, `${path}.temperature`, 0),
        intensityGroup: toInt(o.intensityGroup, `${path}.intensityGroup`, 0),
        longWeight: toNumber(o.longWeight, `${path}.longWeight`, 0),
        forceWeight: toNumber(o.forceWeight, `${path}.forceWeight`, 0),
        addForceWeight: toNumber(o.addForceWeight, `${path}.addForceWeight`, 0),
        area: toNumber(o.area, `${path}.area`, 0),
        loads: asArray(o.loads, `${path}.loads`).map((lv, loadIndex) => {
          const loadPath = `${path}.loads[${loadIndex}]`;
          const lo = asObject(lv, loadPath);
          return {
            p1: toNumber(lo.p1, `${loadPath}.p1`, 0),
            p2: toNumber(lo.p2, `${loadPath}.p2`, 0),
            p3: toNumber(lo.p3, `${loadPath}.p3`, 0),
            m1: toNumber(lo.m1, `${loadPath}.m1`, 0),
            m2: toNumber(lo.m2, `${loadPath}.m2`, 0),
            m3: toNumber(lo.m3, `${loadPath}.m3`, 0),
          };
        }),
      };
    }),

    members: asArray(raw.members, 'members', false).map((v, index) => {
      const path = `members[${index}]`;
      const o = asObject(v, path);
      return {
        number: toInt(o.number, `${path}.number`),
        iNodeNumber: toInt(o.iNodeNumber, `${path}.iNodeNumber`),
        jNodeNumber: toInt(o.jNodeNumber, `${path}.jNodeNumber`),
        ixSpring: toInt(o.ixSpring, `${path}.ixSpring`, 0),
        iySpring: toInt(o.iySpring, `${path}.iySpring`, 0),
        izSpring: toInt(o.izSpring, `${path}.izSpring`, 0),
        jxSpring: toInt(o.jxSpring, `${path}.jxSpring`, 0),
        jySpring: toInt(o.jySpring, `${path}.jySpring`, 0),
        jzSpring: toInt(o.jzSpring, `${path}.jzSpring`, 0),
        sectionNumber: toInt(o.sectionNumber, `${path}.sectionNumber`),
        p1: toNumber(o.p1, `${path}.p1`, 0),
        p2: toNumber(o.p2, `${path}.p2`, 0),
        p3: toNumber(o.p3, `${path}.p3`, 0),
        memberLoads: asArray(o.memberLoads, `${path}.memberLoads`).map((mlv, loadIndex) => {
          const loadPath = `${path}.memberLoads[${loadIndex}]`;
          const mlo = asObject(mlv, loadPath);
          return {
            lengthMethod: toInt(mlo.lengthMethod, `${loadPath}.lengthMethod`, 0),
            type: toInt(mlo.type, `${loadPath}.type`, 0),
            direction: toInt(mlo.direction, `${loadPath}.direction`, 0),
            scale: toNumber(mlo.scale, `${loadPath}.scale`, 0),
            loadCode: toString_(mlo.loadCode),
            unitLoad: toNumber(mlo.unitLoad, `${loadPath}.unitLoad`, 0),
            p1: toNumber(mlo.p1, `${loadPath}.p1`, 0),
            p2: toNumber(mlo.p2, `${loadPath}.p2`, 0),
            p3: toNumber(mlo.p3, `${loadPath}.p3`, 0),
          };
        }),
        cmqLoads: asArray(o.cmqLoads, `${path}.cmqLoads`).map((cv, loadIndex) => {
          const loadPath = `${path}.cmqLoads[${loadIndex}]`;
          const co = asObject(cv, loadPath);
          return {
            moy: toNumber(co.moy, `${loadPath}.moy`, 0),
            moz: toNumber(co.moz, `${loadPath}.moz`, 0),
            iMy: toNumber(co.iMy, `${loadPath}.iMy`, 0),
            iMz: toNumber(co.iMz, `${loadPath}.iMz`, 0),
            iQx: toNumber(co.iQx, `${loadPath}.iQx`, 0),
            iQy: toNumber(co.iQy, `${loadPath}.iQy`, 0),
            iQz: toNumber(co.iQz, `${loadPath}.iQz`, 0),
            jMy: toNumber(co.jMy, `${loadPath}.jMy`, 0),
            jMz: toNumber(co.jMz, `${loadPath}.jMz`, 0),
            jQx: toNumber(co.jQx, `${loadPath}.jQx`, 0),
            jQy: toNumber(co.jQy, `${loadPath}.jQy`, 0),
            jQz: toNumber(co.jQz, `${loadPath}.jQz`, 0),
          };
        }),
      };
    }),

    sections: asArray(raw.sections, 'sections', false).map((v, index) => {
      const path = `sections[${index}]`;
      const o = asObject(v, path);
      return {
        number: toInt(o.number, `${path}.number`),
        materialNumber: toInt(o.materialNumber, `${path}.materialNumber`),
        type: toInt(o.type, `${path}.type`, 0),
        shape: toInt(o.shape, `${path}.shape`, 0),
        p1_A: toNumber(o.p1_A, `${path}.p1_A`),
        p2_Ix: toNumber(o.p2_Ix, `${path}.p2_Ix`),
        p3_Iy: toNumber(o.p3_Iy, `${path}.p3_Iy`),
        p4_Iz: toNumber(o.p4_Iz, `${path}.p4_Iz`),
        ky: toNumber(o.ky, `${path}.ky`, 0),
        kz: toNumber(o.kz, `${path}.kz`, 0),
        comment: toString_(o.comment),
      };
    }),

    materials: asArray(raw.materials, 'materials', false).map((v, index) => {
      const path = `materials[${index}]`;
      const o = asObject(v, path);
      return {
        number: toInt(o.number, `${path}.number`),
        young: toNumber(o.young, `${path}.young`),
        shear: toNumber(o.shear, `${path}.shear`, 0),
        expansion: toNumber(o.expansion, `${path}.expansion`, 0),
        ...(o.poisson === undefined ? {} : { poisson: toNumber(o.poisson, `${path}.poisson`) }),
        unitLoad: toNumber(o.unitLoad, `${path}.unitLoad`, 0),
        name: toString_(o.name),
      };
    }),

    boundaries: asArray(raw.boundaries, 'boundaries').map((v, index) => {
      const path = `boundaries[${index}]`;
      const o = asObject(v, path);
      return {
        nodeNumber: toInt(o.nodeNumber, `${path}.nodeNumber`),
        deltaX: toInt(o.deltaX, `${path}.deltaX`, 0),
        deltaY: toInt(o.deltaY, `${path}.deltaY`, 0),
        deltaZ: toInt(o.deltaZ, `${path}.deltaZ`, 0),
        thetaX: toInt(o.thetaX, `${path}.thetaX`, 0),
        thetaY: toInt(o.thetaY, `${path}.thetaY`, 0),
        thetaZ: toInt(o.thetaZ, `${path}.thetaZ`, 0),
      };
    }),

    springs: asArray(raw.springs, 'springs').map((v, index) => {
      const path = `springs[${index}]`;
      const o = asObject(v, path);
      return {
        number: toInt(o.number, `${path}.number`),
        method: toInt(o.method, `${path}.method`, 0),
        kTheta: toNumber(o.kTheta, `${path}.kTheta`, 0),
      };
    }),

    walls: asArray(raw.walls, 'walls').map((v, index) => {
      const path = `walls[${index}]`;
      const o = asObject(v, path);
      return {
        number: toInt(o.number, `${path}.number`),
        leftBottomNode: toInt(o.leftBottomNode, `${path}.leftBottomNode`),
        rightBottomNode: toInt(o.rightBottomNode, `${path}.rightBottomNode`),
        leftTopNode: toInt(o.leftTopNode, `${path}.leftTopNode`),
        rightTopNode: toInt(o.rightTopNode, `${path}.rightTopNode`),
        materialNumber: toInt(o.materialNumber, `${path}.materialNumber`),
        method: toInt(o.method, `${path}.method`, 0),
        p1: toNumber(o.p1, `${path}.p1`, 0),
        p2: toNumber(o.p2, `${path}.p2`, 0),
        p3: toNumber(o.p3, `${path}.p3`, 0),
        p4: toNumber(o.p4, `${path}.p4`, 0),
      };
    }),
  };
}

/** Parse a JSON string into a FrameJsonDocument with strict numeric validation. */
export function parseFrameJsonText(text: string): FrameJsonDocument {
  return parseFrameJson(parseJsonText(text));
}

/**
 * Detect whether a parsed JSON object is a FrameJsonDocument.
 */
export function isFrameJsonFormat(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const o = obj as Record<string, unknown>;
  return (
    Array.isArray(o.nodes) &&
    Array.isArray(o.members) &&
    Array.isArray(o.materials) &&
    Array.isArray(o.sections)
  );
}
