/**
 * 新手引导的状态与记忆。
 *
 * 欢迎页默认每次启动都弹（可在「设置 → 通用 → 启动」里关掉），所以这里只需要记住
 * 「启动时是否显示」这一项偏好；步骤、文案、锚点都属于界面，跟着 `GuidedTour.vue` 走。
 */
import { defineStore } from "pinia";
import { ref } from "vue";

const KEY = "ai-cut-onboarding";

interface Saved {
  welcomeOnStart: boolean;
  coachDismissed: boolean;
}

const EMPTY: Saved = { welcomeOnStart: true, coachDismissed: false };

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    return {
      welcomeOnStart: parsed.welcomeOnStart !== false,
      coachDismissed: parsed.coachDismissed === true,
    };
  } catch {
    return EMPTY;
  }
}

export const useOnboardingStore = defineStore("onboarding", () => {
  const saved = load();

  /** 启动时是否自动打开欢迎页。 */
  const welcomeOnStart = ref(saved.welcomeOnStart);
  /** 空工程引导是否被用户关掉（只记偏好，不阻塞编辑）。 */
  const coachDismissed = ref(saved.coachDismissed);
  /** 欢迎面板是否打开。 */
  const welcomeOpen = ref(false);
  /** 聚光灯引导是否进行中。 */
  const tourOpen = ref(false);
  /** 当前步骤下标（换步骤只改这个值，由引导组件自己滚动 / 量位置）。 */
  const step = ref(0);

  function persist(): void {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          welcomeOnStart: welcomeOnStart.value,
          coachDismissed: coachDismissed.value,
        } satisfies Saved),
      );
    } catch {
      // 无痕模式 / 存储被禁用：记不住就记不住，最多下次再弹一遍，不影响功能。
    }
  }

  function setWelcomeOnStart(value: boolean): void {
    welcomeOnStart.value = value;
    persist();
  }

  function dismissCoach(): void {
    coachDismissed.value = true;
    persist();
  }

  function openWelcome(): void {
    welcomeOpen.value = true;
  }

  function closeWelcome(): void {
    welcomeOpen.value = false;
  }

  /** 从欢迎页（或帮助菜单）进入引导。 */
  function startTour(): void {
    welcomeOpen.value = false;
    step.value = 0;
    tourOpen.value = true;
  }

  function endTour(): void {
    tourOpen.value = false;
    step.value = 0;
  }

  function goStep(next: number): void {
    step.value = Math.max(0, next);
  }

  return {
    welcomeOnStart,
    coachDismissed,
    dismissCoach,
    welcomeOpen,
    tourOpen,
    step,
    setWelcomeOnStart,
    openWelcome,
    closeWelcome,
    startTour,
    endTour,
    goStep,
  };
});
