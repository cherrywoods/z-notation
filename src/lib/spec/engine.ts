// The example generator and the inference engine, as used by the side panels.

import { exampleInit, exampleOperation, exampleState, exampleTypes } from '../z/generate';
import { infer } from '../z/infer';

export const generator = { exampleTypes, exampleState, exampleInit, exampleOperation };
export const inference = { infer };
