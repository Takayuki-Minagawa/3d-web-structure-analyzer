import { MOUSE } from 'three';

/** Left drag belongs to model editing; camera gestures match the published help. */
export const CAMERA_MOUSE_BUTTONS = Object.freeze({
  LEFT: null,
  MIDDLE: MOUSE.PAN,
  RIGHT: MOUSE.ROTATE,
});
