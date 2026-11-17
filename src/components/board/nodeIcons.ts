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
  ScissorsIcon,
  SparklesIcon,
  SpeakerWaveIcon,
  Squares2X2Icon,
  Square3Stack3DIcon,
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
  "model.demux": ScissorsIcon,
  group: Square3Stack3DIcon,
};

const CATEGORY_ICONS: Record<BoardCategory, unknown> = {
  input: ArrowRightEndOnRectangleIcon,
  display: EyeIcon,
  model: CpuChipIcon,
  group: Square3Stack3DIcon,
};

export function nodeIcon(type: string): unknown {
  return NODE_ICONS[type] ?? Squares2X2Icon;
}

export function categoryIcon(category: BoardCategory): unknown {
  return CATEGORY_ICONS[category] ?? WrenchScrewdriverIcon;
}
