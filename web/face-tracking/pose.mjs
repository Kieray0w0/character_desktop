const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// MediaPipe serializes the affine face transform in column-major order.
export function faceRotation(matrix) {
  if (matrix?.length !== 16 || !Array.from(matrix).every(Number.isFinite)) return null;
  const lengths = [0, 4, 8].map(i => Math.hypot(matrix[i], matrix[i + 1], matrix[i + 2]));
  if (lengths.some(length => length < 1e-6)) return null;
  return Array.from({ length: 9 }, (_, i) => matrix[(i % 3) * 4 + Math.floor(i / 3)] / lengths[i % 3]);
}

export function faceSample(result, neutral) {
  const rotation = faceRotation(result.facialTransformationMatrixes?.[0]?.data);
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (!rotation || !categories?.length) return null;
  const scores = Object.fromEntries(categories.map(({ categoryName, score }) => [categoryName, score]));
  const score = name => Number.isFinite(scores[name]) ? clamp(scores[name], 0, 1) : 0;
  const reference = neutral || rotation;
  // Inverse(neutral) * current removes the user's seated camera angle.
  const relative = Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3), col = i % 3;
    return [0, 1, 2].reduce((sum, k) => sum + reference[k * 3 + row] * rotation[k * 3 + col], 0);
  });
  const degrees = 180 / Math.PI;
  return {
    rotation,
    values: {
      yaw: clamp(-Math.atan2(-relative[6], Math.hypot(relative[0], relative[3])) * degrees, -30, 30),
      pitch: clamp(Math.atan2(relative[7], relative[8]) * degrees, -25, 25),
      roll: clamp(-Math.atan2(relative[3], relative[0]) * degrees, -25, 25),
      eyeOpenL: 1 - score('eyeBlinkLeft'),
      eyeOpenR: 1 - score('eyeBlinkRight'),
      jawOpen: clamp(score('jawOpen') * 1.6, 0, 1),
      smile: clamp((score('mouthSmileLeft') + score('mouthSmileRight')) * 0.8, 0, 1),
      browL: clamp(score('browInnerUp') + score('browOuterUpLeft') - score('browDownLeft'), -1, 1),
      browR: clamp(score('browInnerUp') + score('browOuterUpRight') - score('browDownRight'), -1, 1),
    },
  };
}
