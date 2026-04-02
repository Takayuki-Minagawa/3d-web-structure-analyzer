import type { FrameJsonDocument } from './frameJsonTypes';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toInt(value: unknown): number {
  return Math.trunc(toNumber(value));
}

function toString_(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

/**
 * Parse a JSON string into a FrameJsonDocument with safe type coercion.
 */
export function parseFrameJsonText(text: string): FrameJsonDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON: root must be an object');
  }

  const raw = parsed as JsonObject;

  return {
    title: toString_(raw.title),
    loadCaseCount: Math.max(1, toInt(raw.loadCaseCount)),
    loadCaseIndex: Math.max(0, toInt(raw.loadCaseIndex)),
    calcCaseMemo: asArray(raw.calcCaseMemo).map(toString_),

    nodes: asArray(raw.nodes).map((v) => {
      const o = asObject(v);
      return {
        number: toInt(o.number),
        x: toNumber(o.x),
        y: toNumber(o.y),
        z: toNumber(o.z),
        temperature: toNumber(o.temperature),
        intensityGroup: toInt(o.intensityGroup),
        longWeight: toNumber(o.longWeight),
        forceWeight: toNumber(o.forceWeight),
        addForceWeight: toNumber(o.addForceWeight),
        area: toNumber(o.area),
        loads: asArray(o.loads).map((lv) => {
          const lo = asObject(lv);
          return {
            p1: toNumber(lo.p1),
            p2: toNumber(lo.p2),
            p3: toNumber(lo.p3),
            m1: toNumber(lo.m1),
            m2: toNumber(lo.m2),
            m3: toNumber(lo.m3),
          };
        }),
      };
    }),

    members: asArray(raw.members).map((v) => {
      const o = asObject(v);
      return {
        number: toInt(o.number),
        iNodeNumber: toInt(o.iNodeNumber),
        jNodeNumber: toInt(o.jNodeNumber),
        ixSpring: toInt(o.ixSpring),
        iySpring: toInt(o.iySpring),
        izSpring: toInt(o.izSpring),
        jxSpring: toInt(o.jxSpring),
        jySpring: toInt(o.jySpring),
        jzSpring: toInt(o.jzSpring),
        sectionNumber: toInt(o.sectionNumber),
        p1: toNumber(o.p1),
        p2: toNumber(o.p2),
        p3: toNumber(o.p3),
        memberLoads: asArray(o.memberLoads).map((mlv) => {
          const mlo = asObject(mlv);
          return {
            lengthMethod: toInt(mlo.lengthMethod),
            type: toInt(mlo.type),
            direction: toInt(mlo.direction),
            scale: toNumber(mlo.scale),
            loadCode: toString_(mlo.loadCode),
            unitLoad: toNumber(mlo.unitLoad),
            p1: toNumber(mlo.p1),
            p2: toNumber(mlo.p2),
            p3: toNumber(mlo.p3),
          };
        }),
        cmqLoads: asArray(o.cmqLoads).map((cv) => {
          const co = asObject(cv);
          return {
            moy: toNumber(co.moy),
            moz: toNumber(co.moz),
            iMy: toNumber(co.iMy),
            iMz: toNumber(co.iMz),
            iQx: toNumber(co.iQx),
            iQy: toNumber(co.iQy),
            iQz: toNumber(co.iQz),
            jMy: toNumber(co.jMy),
            jMz: toNumber(co.jMz),
            jQx: toNumber(co.jQx),
            jQy: toNumber(co.jQy),
            jQz: toNumber(co.jQz),
          };
        }),
      };
    }),

    sections: asArray(raw.sections).map((v) => {
      const o = asObject(v);
      return {
        number: toInt(o.number),
        materialNumber: toInt(o.materialNumber),
        type: toInt(o.type),
        shape: toInt(o.shape),
        p1_A: toNumber(o.p1_A),
        p2_Ix: toNumber(o.p2_Ix),
        p3_Iy: toNumber(o.p3_Iy),
        p4_Iz: toNumber(o.p4_Iz),
        ky: toNumber(o.ky),
        kz: toNumber(o.kz),
        comment: toString_(o.comment),
      };
    }),

    materials: asArray(raw.materials).map((v) => {
      const o = asObject(v);
      return {
        number: toInt(o.number),
        young: toNumber(o.young),
        shear: toNumber(o.shear),
        expansion: toNumber(o.expansion),
        poisson: toNumber(o.poisson),
        unitLoad: toNumber(o.unitLoad),
        name: toString_(o.name),
      };
    }),

    boundaries: asArray(raw.boundaries).map((v) => {
      const o = asObject(v);
      return {
        nodeNumber: toInt(o.nodeNumber),
        deltaX: toInt(o.deltaX),
        deltaY: toInt(o.deltaY),
        deltaZ: toInt(o.deltaZ),
        thetaX: toInt(o.thetaX),
        thetaY: toInt(o.thetaY),
        thetaZ: toInt(o.thetaZ),
      };
    }),

    springs: asArray(raw.springs).map((v) => {
      const o = asObject(v);
      return {
        number: toInt(o.number),
        method: toInt(o.method),
        kTheta: toNumber(o.kTheta),
      };
    }),

    walls: asArray(raw.walls).map((v) => {
      const o = asObject(v);
      return {
        number: toInt(o.number),
        leftBottomNode: toInt(o.leftBottomNode),
        rightBottomNode: toInt(o.rightBottomNode),
        leftTopNode: toInt(o.leftTopNode),
        rightTopNode: toInt(o.rightTopNode),
        materialNumber: toInt(o.materialNumber),
        method: toInt(o.method),
        p1: toNumber(o.p1),
        p2: toNumber(o.p2),
        p3: toNumber(o.p3),
        p4: toNumber(o.p4),
      };
    }),
  };
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
    Array.isArray(o.sections) &&
    Array.isArray(o.boundaries)
  );
}
