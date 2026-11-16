/** 画布节点的图标映射（UI 侧）：与 ai-board 一样，节点选项与卡片头部都带图标。 */
import {
  ArrowsPointingOutIcon,
  ArrowRightEndOnRectangleIcon,
  ChatBubbleLeftRightIcon,
  CpuChipIcon,
  DocumentTextIcon,
  EyeIcon,
  FilmIcon,
  MusicalNoteIcon,
  PhotoIcon,
  QueueListIcon,
  SparklesIcon,
  SpeakerWaveIcon,
  Squares2X2Icon,
  VideoCameraIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/vue/24/outline";
import type { BoardCategory } from "@/types/board";

const NODE_ICONS: Record<string, unknown> = {
  "input.image": PhotoIcon,
  "input.video": VideoCameraIcon,
  "input.audio": MusicalNoteIcon,
  "input.text": DocumentTextIcon,
  "display.image": EyeIcon,
  "display.video": FilmIcon,
  "display.audio": SpeakerWaveIcon,
  "display.text": DocumentTextIcon,
  "model.image": SparklesIcon,
  "model.video": VideoCameraIcon,
  "model.tts": SpeakerWaveIcon,
  "model.asr": DocumentTextIcon,
  "model.text": ChatBubbleLeftRightIcon,
  "model.enhance": ArrowsPointingOutIcon,
  "model.separate": QueueListIcon,
};

const CATEGORY_ICONS: Record<BoardCategory, unknown> = {
  input: ArrowRightEndOnRectangleIcon,
  display: EyeIcon,
  model: CpuChipIcon,
};

export function nodeIcon(type: string): unknown {
  return NODE_ICONS[type] ?? Squares2X2Icon;
}

export function categoryIcon(category: BoardCategory): unknown {
  return CATEGORY_ICONS[category] ?? WrenchScrewdriverIcon;
}
