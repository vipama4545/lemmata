// The stories the reader offers. Each one is generated from its .txt source by
// scripts/buildStoryData.cjs; adding another means dropping the .txt in stories/, running
// `npm run build:data`, then adding both a line here and a module declaration in
// data.d.ts — an ambient pattern may hold only one '*', so the directory cannot be
// covered in a single wildcard.

import type { Story } from '../types';
import threeLittlePigs from './stories/three-little-pigs.json';

export const stories: Story[] = [threeLittlePigs];

export function storyById(id: string | undefined): Story | undefined {
  return id ? stories.find(story => story.id === id) : undefined;
}
