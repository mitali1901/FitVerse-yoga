/**
 * FitVerse Pose Evaluation Engine
 * Evaluates MediaPipe body landmarks for Tree Pose, Warrior II, and Downward-Facing Dog.
 * Computes individual segment alignment (Green = Aligned, Red = Needs Correction).
 */

import { calculateAngle, calculateHorizontalAngle, calculateVerticalAngle, midPoint, calculateDistance } from './angleCalculator';

// MediaPipe Pose Landmark Indices (Standard 33-point model)
export const LM = {
  NOSE: 0,
  LEFT_EYE: 2,
  RIGHT_EYE: 5,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
};

const MIN_VISIBILITY = 0.5;

function isVisible(...points) {
  return points.every(p => p && (p.visibility === undefined || p.visibility >= MIN_VISIBILITY));
}

/**
 * Evaluates Warrior II Pose (Virabhadrasana II)
 */
export function evaluateWarriorII(landmarks) {
  if (!landmarks || landmarks.length < 29) {
    return {
      alignmentScore: 0,
      statusText: "Waiting for Pose...",
      feedbackList: [{ id: "visibility", text: "Please step back so your entire body is in camera frame.", passed: false, isWarning: true }],
      segments: {},
      criticalJoint: null
    };
  }

  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const le = landmarks[LM.LEFT_ELBOW];
  const re = landmarks[LM.RIGHT_ELBOW];
  const lw = landmarks[LM.LEFT_WRIST];
  const rw = landmarks[LM.RIGHT_WRIST];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  const lk = landmarks[LM.LEFT_KNEE];
  const rk = landmarks[LM.RIGHT_KNEE];
  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];

  // Ensure landmarks are valid
  if (!ls || !rs || !lh || !rh) {
    return {
      alignmentScore: 0,
      statusText: "Detecting Body...",
      feedbackList: [{ id: "visibility", text: "Step into camera view to begin.", passed: false, isWarning: true }],
      segments: {},
      criticalJoint: null
    };
  }

  // POSE CONFIDENCE CHECK: Verify user is actually attempting Warrior II before evaluating
  // Very lenient: one knee bent (50-140°) and other relatively straight (130-180°)
  const leftKneeAngle = calculateAngle(lh, lk, la);
  const rightKneeAngle = calculateAngle(rh, rk, ra);
  const oneKneeBent = (leftKneeAngle >= 50 && leftKneeAngle <= 140) || (rightKneeAngle >= 50 && rightKneeAngle <= 140);
  const oneKneeStraight = (leftKneeAngle >= 130 && leftKneeAngle <= 180) || (rightKneeAngle >= 130 && rightKneeAngle <= 180);
  
  if (!oneKneeBent || !oneKneeStraight) {
    return {
      alignmentScore: 0,
      statusText: "Not in Warrior II Pose",
      feedbackList: [{ id: "pose_check", text: "Please get into Warrior II pose: one leg bent at 90°, other leg straight, arms extended.", passed: false, isWarning: true }],
      segments: {},
      criticalJoint: null
    };
  }

  // 1. Joint angles (already calculated in pose check)
  const leftElbowAngle = calculateAngle(ls, le, lw);
  const rightElbowAngle = calculateAngle(rs, re, rw);

  // Determine front leg vs back leg based on knee flexion
  // Front leg knee is bent closer to 90 degrees; back leg is straight (~170)
  const leftDiffFrom90 = Math.abs((leftKneeAngle || 180) - 90);
  const rightDiffFrom90 = Math.abs((rightKneeAngle || 180) - 90);

  const isLeftFront = leftDiffFrom90 <= rightDiffFrom90;
  const frontKneeAngle = isLeftFront ? leftKneeAngle : rightKneeAngle;
  const backKneeAngle = isLeftFront ? rightKneeAngle : leftKneeAngle;
  const frontKneeJoint = isLeftFront ? LM.LEFT_KNEE : LM.RIGHT_KNEE;

  // 2. Evaluate front knee: Very lenient range
  const frontKneeCorrect = frontKneeAngle !== null && frontKneeAngle >= 60 && frontKneeAngle <= 130;
  const backLegCorrect = backKneeAngle !== null && backKneeAngle >= 130;

  // 3. Arm parallelity (horizontal angle of arm lines) - very lenient
  const leftArmHoriz = calculateHorizontalAngle(ls, lw);
  const rightArmHoriz = calculateHorizontalAngle(rs, rw);
  const leftArmStraight = leftElbowAngle !== null && leftElbowAngle >= 90;
  const rightArmStraight = rightElbowAngle !== null && rightElbowAngle >= 90;
  const armsParallel = (leftArmHoriz !== null && leftArmHoriz <= 70) &&
                       (rightArmHoriz !== null && rightArmHoriz <= 70) &&
                       leftArmStraight && rightArmStraight;

  // 4. Torso alignment (vertical upright) - very lenient
  const midShoulder = midPoint(ls, rs);
  const midHip = midPoint(lh, rh);
  const torsoTilt = calculateVerticalAngle(midShoulder, midHip);
  const backStraight = torsoTilt !== null && torsoTilt <= 50;

  // 5. Stance stability (wide base)
  const ankleDist = calculateDistance(la, ra);
  const shoulderDist = calculateDistance(ls, rs);
  const stanceStable = ankleDist >= (shoulderDist * 1.7);

  // Segments coloring state (Green = Aligned, Red = Needs Correction)
  const segments = {
    torso: backStraight,
    left_arm: (leftArmHoriz <= 70 && leftArmStraight),
    right_arm: (rightArmHoriz <= 70 && rightArmStraight),
    left_leg: isLeftFront ? frontKneeCorrect : backLegCorrect,
    right_leg: isLeftFront ? backLegCorrect : frontKneeCorrect,
    front_knee_joint: frontKneeCorrect,
  };

  // Feedback items matching the user's reference design
  const feedbackList = [
    {
      id: "front_knee",
      text: frontKneeCorrect ? "Front knee correctly aligned at ~90°." : "Adjust your front knee.",
      passed: frontKneeCorrect,
      isWarning: !frontKneeCorrect,
      segmentKey: isLeftFront ? "left_leg" : "right_leg",
      angle: frontKneeAngle,
      target: "85° - 105°"
    },
    {
      id: "arms",
      text: armsParallel ? "Arms parallel to the floor." : "Keep your arms parallel to the floor.",
      passed: armsParallel,
      isWarning: !armsParallel,
      segmentKey: "arms"
    },
    {
      id: "back",
      text: backStraight ? "Back and torso upright." : "Keep your back straight.",
      passed: backStraight,
      isWarning: !backStraight,
      segmentKey: "torso"
    },
    {
      id: "stance",
      text: stanceStable ? "Stable wide stance maintained." : "Maintain a stable stance.",
      passed: stanceStable,
      isWarning: !stanceStable,
      segmentKey: "stance"
    }
  ];

  // Dynamic Alignment Score: percentage of passing evaluated rules
  const evaluatedRules = [frontKneeCorrect, armsParallel, backStraight, backLegCorrect, stanceStable];
  const passedCount = evaluatedRules.filter(Boolean).length;
  const score = Math.round((passedCount / evaluatedRules.length) * 100);

  return {
    alignmentScore: score,
    statusText: score >= 80 ? "Good Alignment" : (score >= 60 ? "Moderate Alignment" : "Needs Improvement"),
    feedbackList,
    segments,
    criticalJoint: !frontKneeCorrect ? frontKneeJoint : null,
    isLeftFront
  };
}

/**
 * Evaluates Tree Pose (Vrikshasana)
 */
export function evaluateTreePose(landmarks) {
  if (!landmarks || landmarks.length < 29) {
    return {
      alignmentScore: 0,
      statusText: "Waiting for Pose...",
      feedbackList: [{ id: "visibility", text: "Please step back so your entire body is in camera frame.", passed: false, isWarning: true }],
      segments: {},
      criticalJoint: null
    };
  }

  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lw = landmarks[LM.LEFT_WRIST];
  const rw = landmarks[LM.RIGHT_WRIST];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  const lk = landmarks[LM.LEFT_KNEE];
  const rk = landmarks[LM.RIGHT_KNEE];
  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];

  // Ensure landmarks are valid
  if (!ls || !rs || !lh || !rh) {
    return {
      alignmentScore: 0,
      statusText: "Detecting Body...",
      feedbackList: [{ id: "visibility", text: "Step into camera view to begin.", passed: false, isWarning: true }],
      segments: {},
      criticalJoint: null
    };
  }

  const leftKneeAngle = calculateAngle(lh, lk, la);
  const rightKneeAngle = calculateAngle(rh, rk, ra);

  // POSE CONFIDENCE CHECK: Verify user is actually attempting Tree Pose before evaluating
  // Very lenient: one knee bent (15-110°) and other straight (130-180°)
  const oneKneeBent = (leftKneeAngle >= 15 && leftKneeAngle <= 110) || (rightKneeAngle >= 15 && rightKneeAngle <= 110);
  const oneKneeStraight = (leftKneeAngle >= 130 && leftKneeAngle <= 180) || (rightKneeAngle >= 130 && rightKneeAngle <= 180);
  
  if (!oneKneeBent || !oneKneeStraight) {
    return {
      alignmentScore: 0,
      statusText: "Not in Tree Pose",
      feedbackList: [{ id: "pose_check", text: "Please get into Tree Pose: one leg straight, other knee bent with foot on inner calf/thigh.", passed: false, isWarning: true }],
      segments: {},
      criticalJoint: null
    };
  }

  // Standing leg has knee angle ~180; Bent leg has knee angle ~30 - 80
  const isLeftStanding = (leftKneeAngle || 0) > (rightKneeAngle || 0);
  const standingKneeAngle = isLeftStanding ? leftKneeAngle : rightKneeAngle;
  const bentKneeAngle = isLeftStanding ? rightKneeAngle : leftKneeAngle;

  const standingLegStraight = standingKneeAngle !== null && standingKneeAngle >= 130;
  const bentLegFolded = bentKneeAngle !== null && bentKneeAngle >= 15 && bentKneeAngle <= 110;

  // Hands in prayer (wrists close together) OR extended overhead
  const wristDist = calculateDistance(lw, rw);
  const handsInPrayer = wristDist < 0.20 || (lw.y < ls.y && rw.y < rs.y && wristDist < 0.28);

  // Spine upright - very lenient
  const midShoulder = midPoint(ls, rs);
  const midHip = midPoint(lh, rh);
  const spineTilt = calculateVerticalAngle(midShoulder, midHip);
  const spineUpright = spineTilt !== null && spineTilt <= 45;

  const segments = {
    torso: spineUpright,
    left_arm: handsInPrayer,
    right_arm: handsInPrayer,
    left_leg: isLeftStanding ? standingLegStraight : bentLegFolded,
    right_leg: isLeftStanding ? bentLegFolded : standingLegStraight,
  };

  const feedbackList = [
    {
      id: "standing_leg",
      text: standingLegStraight ? "Standing leg is strong and rooted." : "Keep your standing leg straight and rooted.",
      passed: standingLegStraight,
      isWarning: !standingLegStraight,
      segmentKey: isLeftStanding ? "left_leg" : "right_leg"
    },
    {
      id: "bent_knee",
      text: bentLegFolded ? "Folded knee abducted correctly." : "Place foot on inner calf or thigh (avoid knee joint).",
      passed: bentLegFolded,
      isWarning: !bentLegFolded,
      segmentKey: isLeftStanding ? "right_leg" : "left_leg"
    },
    {
      id: "spine",
      text: spineUpright ? "Spine is upright and aligned." : "Maintain a long, upright spine.",
      passed: spineUpright,
      isWarning: !spineUpright,
      segmentKey: "torso"
    },
    {
      id: "hands",
      text: handsInPrayer ? "Hands in prayer / raised overhead." : "Bring palms together at your chest or overhead.",
      passed: handsInPrayer,
      isWarning: !handsInPrayer,
      segmentKey: "arms"
    }
  ];

  // Dynamic Alignment Score: 4 evaluated rules
  const evaluatedRules = [standingLegStraight, bentLegFolded, spineUpright, handsInPrayer];
  const passedCount = evaluatedRules.filter(Boolean).length;
  const score = Math.round((passedCount / evaluatedRules.length) * 100);

  return {
    alignmentScore: score,
    statusText: score >= 75 ? "Good Alignment" : "Needs Improvement",
    feedbackList,
    segments,
    criticalJoint: !standingLegStraight ? (isLeftStanding ? LM.LEFT_KNEE : LM.RIGHT_KNEE) : (!bentLegFolded ? (isLeftStanding ? LM.RIGHT_KNEE : LM.LEFT_KNEE) : null)
  };
}

/**
 * Evaluates Downward-Facing Dog (Adho Mukha Svanasana)
 */
export function evaluateDownwardDog(landmarks) {
  if (!landmarks || landmarks.length < 29) {
    return {
      alignmentScore: 0,
      statusText: "Waiting for Pose...",
      feedbackList: [{ id: "visibility", text: "Ensure whole mat and body are visible in frame.", passed: false, isWarning: true }],
      segments: {},
      criticalJoint: null
    };
  }

  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const le = landmarks[LM.LEFT_ELBOW];
  const re = landmarks[LM.RIGHT_ELBOW];
  const lw = landmarks[LM.LEFT_WRIST];
  const rw = landmarks[LM.RIGHT_WRIST];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  const lk = landmarks[LM.LEFT_KNEE];
  const rk = landmarks[LM.RIGHT_KNEE];
  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];

  // Ensure landmarks are valid
  if (!ls || !rs || !lh || !rh) {
    return {
      alignmentScore: 0,
      statusText: "Detecting Body...",
      feedbackList: [{ id: "visibility", text: "Step into camera view to begin.", passed: false, isWarning: true }],
      segments: {},
      criticalJoint: null
    };
  }

  const leftArmAngle = calculateAngle(ls, le, lw);
  const rightArmAngle = calculateAngle(rs, re, rw);
  const leftLegAngle = calculateAngle(lh, lk, la);
  const rightLegAngle = calculateAngle(rh, rk, ra);

  // POSE CONFIDENCE CHECK: Verify user is actually attempting Downward Dog before evaluating
  // Very lenient: hips higher than shoulders, arms/legs extended
  const midHip = midPoint(lh, rh);
  const midShoulder = midPoint(ls, rs);
  const hipsHigherThanShoulders = midHip.y < midShoulder.y;
  const armsExtended = (leftArmAngle >= 100 && leftArmAngle <= 180) && (rightArmAngle >= 100 && rightArmAngle <= 180);
  const legsExtendedCheck = (leftLegAngle >= 100 && leftLegAngle <= 180) && (rightLegAngle >= 100 && rightLegAngle <= 180);

  if (!hipsHigherThanShoulders || !armsExtended || !legsExtendedCheck) {
    return {
      alignmentScore: 0,
      statusText: "Not in Downward Dog",
      feedbackList: [{ id: "pose_check", text: "Please get into Downward Dog: hands on floor, lift hips high, form inverted 'V' shape.", passed: false, isWarning: true }],
      segments: {},
      criticalJoint: null
    };
  }

  // Hip apex angle (between shoulder, hip, and ankle/knee)
  const leftHipAngle = calculateAngle(ls, lh, lk);
  const rightHipAngle = calculateAngle(rs, rh, rk);
  const avgHipAngle = ((leftHipAngle || 90) + (rightHipAngle || 90)) / 2;

  // Inverted V shape: hip angle - very lenient
  const invertedVCorrect = avgHipAngle >= 40 && avgHipAngle <= 120;
  const armsStraight = (leftArmAngle !== null && leftArmAngle >= 100) && (rightArmAngle !== null && rightArmAngle >= 100);
  const legsExtended = (leftLegAngle !== null && leftLegAngle >= 100) && (rightLegAngle !== null && rightLegAngle >= 100);

  const segments = {
    torso: invertedVCorrect && hipsHigherThanShoulders,
    left_arm: leftArmAngle >= 100,
    right_arm: rightArmAngle >= 100,
    left_leg: leftLegAngle >= 100,
    right_leg: rightLegAngle >= 100
  };

  const feedbackList = [
    {
      id: "hips",
      text: (invertedVCorrect && hipsHigherThanShoulders) ? "Inverted 'V' shape formed correctly." : "Lift your hips high to form an inverted 'V'.",
      passed: invertedVCorrect && hipsHigherThanShoulders,
      isWarning: !(invertedVCorrect && hipsHigherThanShoulders),
      segmentKey: "torso"
    },
    {
      id: "arms",
      text: armsStraight ? "Arms straight and pressing firmly." : "Keep your arms straight and press firmly through hands.",
      passed: armsStraight,
      isWarning: !armsStraight,
      segmentKey: "arms"
    },
    {
      id: "legs",
      text: legsExtended ? "Legs well extended." : "Extend your legs; soften knees if hamstrings feel tight.",
      passed: legsExtended,
      isWarning: !legsExtended,
      segmentKey: "legs"
    },
    {
      id: "neck",
      text: "Neck relaxed with gaze toward navel.",
      passed: true,
      isWarning: false,
      segmentKey: "head"
    }
  ];

  // Dynamic Alignment Score: 4 evaluated rules
  const evaluatedRules = [(invertedVCorrect && hipsHigherThanShoulders), armsStraight, legsExtended, true];
  const passedCount = evaluatedRules.filter(Boolean).length;
  const score = Math.round((passedCount / evaluatedRules.length) * 100);

  return {
    alignmentScore: score,
    statusText: score >= 75 ? "Good Alignment" : "Needs Improvement",
    feedbackList,
    segments,
    criticalJoint: !armsStraight ? LM.LEFT_ELBOW : (!invertedVCorrect ? LM.LEFT_HIP : null)
  };
}

/**
 * Generic Posture Evaluator - works for any pose
 * Evaluates general posture principles: symmetry, alignment, joint health
 */
export function evaluateGenericPose(landmarks) {
  if (!landmarks || landmarks.length < 20) {
    return {
      alignmentScore: 0,
      statusText: "Body Not Fully Visible",
      feedbackList: [{ id: "visibility", text: "Ensure full body is visible in the photo.", passed: false, isWarning: true }],
      segments: {},
      criticalJoint: null
    };
  }

  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const le = landmarks[LM.LEFT_ELBOW];
  const re = landmarks[LM.RIGHT_ELBOW];
  const lw = landmarks[LM.LEFT_WRIST];
  const rw = landmarks[LM.RIGHT_WRIST];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  const lk = landmarks[LM.LEFT_KNEE];
  const rk = landmarks[LM.RIGHT_KNEE];
  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];

  // 1. Shoulder Level (Symmetry)
  const shoulderLevel = Math.abs(ls.y - rs.y) < 0.08;

  // 2. Hip Level (Symmetry)
  const hipLevel = Math.abs(lh.y - rh.y) < 0.08;

  // 3. Spine Alignment (Vertical)
  const midShoulder = midPoint(ls, rs);
  const midHip = midPoint(lh, rh);
  const spineTilt = calculateVerticalAngle(midShoulder, midHip);
  const spineAligned = spineTilt !== null && spineTilt <= 20;

  // 4. Knee Alignment (General health check)
  const leftKneeAngle = calculateAngle(lh, lk, la);
  const rightKneeAngle = calculateAngle(rh, rk, ra);
  const kneesHealthy = (leftKneeAngle >= 140 && rightKneeAngle >= 140) ||
                       (leftKneeAngle >= 30 && leftKneeAngle <= 90) ||
                       (rightKneeAngle >= 30 && rightKneeAngle <= 90);

  // 5. Arm Extension (General check)
  const leftElbowAngle = calculateAngle(ls, le, lw);
  const rightElbowAngle = calculateAngle(rs, re, rw);
  const armsExtended = (leftElbowAngle >= 130 && rightElbowAngle >= 130);

  const segments = {
    torso: shoulderLevel && hipLevel && spineAligned,
    left_arm: leftElbowAngle >= 130,
    right_arm: rightElbowAngle >= 130,
    left_leg: leftKneeAngle >= 130 || (leftKneeAngle >= 25 && leftKneeAngle <= 95),
    right_leg: rightKneeAngle >= 130 || (rightKneeAngle >= 25 && rightKneeAngle <= 95),
  };

  const feedbackList = [
    {
      id: "shoulders",
      text: shoulderLevel ? "Shoulders are level and balanced." : "Try to keep your shoulders level.",
      passed: shoulderLevel,
      isWarning: !shoulderLevel,
      segmentKey: "torso"
    },
    {
      id: "hips",
      text: hipLevel ? "Hips are level and balanced." : "Keep your hips level for better alignment.",
      passed: hipLevel,
      isWarning: !hipLevel,
      segmentKey: "torso"
    },
    {
      id: "spine",
      text: spineAligned ? "Spine is well-aligned." : "Focus on keeping your spine straight.",
      passed: spineAligned,
      isWarning: !spineAligned,
      segmentKey: "torso"
    },
    {
      id: "knees",
      text: kneesHealthy ? "Knees are in a healthy position." : "Be mindful of your knee alignment.",
      passed: kneesHealthy,
      isWarning: !kneesHealthy,
      segmentKey: "legs"
    },
    {
      id: "arms",
      text: armsExtended ? "Arms are well-positioned." : "Check your arm positioning.",
      passed: armsExtended,
      isWarning: !armsExtended,
      segmentKey: "arms"
    }
  ];

  const evaluatedRules = [shoulderLevel, hipLevel, spineAligned, kneesHealthy, armsExtended];
  const passedCount = evaluatedRules.filter(Boolean).length;
  const score = Math.round((passedCount / evaluatedRules.length) * 100);

  return {
    alignmentScore: score,
    statusText: score >= 75 ? "Good Posture" : "Needs Adjustment",
    feedbackList,
    segments,
    criticalJoint: !spineAligned ? LM.LEFT_HIP : null
  };
}

/**
 * Universal Pose Evaluator router
 */
export function evaluatePose(poseId, landmarks) {
  if (!landmarks || landmarks.length === 0) {
    return {
      alignmentScore: 0,
      statusText: "Waiting for Pose...",
      feedbackList: [{ id: "none", text: "Step into camera view to begin.", passed: false, isWarning: true }],
      segments: {},
      criticalJoint: null
    };
  }

  const id = (poseId || "warrior_ii").toLowerCase();
  if (id.includes("tree")) {
    return evaluateTreePose(landmarks);
  } else if (id.includes("downward") || id.includes("dog")) {
    return evaluateDownwardDog(landmarks);
  } else {
    // Default to Warrior II
    return evaluateWarriorII(landmarks);
  }
}

