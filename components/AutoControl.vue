<template>
  <UCard v-if="showCard" :ui="{ divide: 'divide-y divide-gray-100 dark:divide-gray-800' }">
    <template #header>
      <div class="flex justify-between items-center gap-3">
        <h2 class="text-2xl flex items-end shrink-0">
          <span>自动操作</span>
          <code class="ml-1 text-sm text-purple-500">({{ autoStore.windowMode ? '窗口后台同步' : '鼠标拖拽' }})</code>
        </h2>
        <div class="flex gap-2 items-center flex-wrap justify-end">
          <USelect v-model="intervalLabel" :options="intervalOptions" size="xs" class="w-28" :disabled="autoStore.running" />
          <UButton
            v-if="!autoStore.running"
            icon="i-lucide:mouse-pointer"
            color="purple"
            :disabled="!autoStore.available || autoStore.executing || autoStore.finished"
            @click="autoStore.runNext()"
          >
            执行下一步
          </UButton>
          <UButton
            v-if="!autoStore.running"
            icon="i-lucide:play"
            color="green"
            :disabled="!autoStore.available || autoStore.finished"
            @click="autoStore.runAll()"
          >
            全自动执行
          </UButton>
          <UButton v-else icon="i-lucide:square" color="red" @click="autoStore.stop()">停止</UButton>
        </div>
      </div>
    </template>

    <div class="space-y-3">
      <!-- 窗口选择与抓取 -->
      <div class="flex items-center gap-2 flex-wrap">
        <USelect
          v-model="windowLabel"
          :options="windowOptions"
          size="sm"
          class="min-w-64"
          :disabled="autoStore.running || windowsLoading"
          @update:model-value="onWindowSelect"
        />
        <UButton
          icon="i-lucide:refresh-cw"
          color="gray"
          variant="ghost"
          size="sm"
          :disabled="autoStore.running || windowsLoading"
          @click="loadWindows"
        >
          {{ windowsLoading ? '扫描中…' : '刷新窗口' }}
        </UButton>
        <UButton
          icon="i-lucide:camera"
          color="blue"
          size="sm"
          :disabled="!gridStore.windowTarget || gridStore.loading"
          @click="gridStore.captureWindowAndLoad()"
        >
          抓取窗口并识别
        </UButton>
      </div>

      <!-- 输入通道与同步校验 -->
      <div class="flex items-center gap-4 flex-wrap">
        <URadioGroup
          v-model="autoStore.inputMode"
          :options="[
            { value: 'window', label: '窗口后台注入 (不占用鼠标)' },
            { value: 'hid', label: '真实鼠标 (占用光标, 窗口需前台)' },
          ]"
          :ui="{ fieldset: 'flex gap-6 flex-1' }"
          size="sm"
          :disabled="autoStore.running"
        />
        <UCheckbox v-model="autoStore.syncVerify" label="每步校验画面同步" size="sm" :disabled="autoStore.running" />
        <URadioGroup
          v-model="autoStore.mode"
          :options="[
            { value: 'step', label: '逐步确认' },
            { value: 'auto', label: '全自动' },
          ]"
          :ui="{ fieldset: 'flex gap-6 flex-1' }"
          size="sm"
        />
      </div>

      <p class="text-sm text-amber-600">
        窗口后台模式: 点击/拖拽直接投递给小程序进程, 您的鼠标可继续做其他事; 小程序窗口保持可见(可被部分遮挡)即可。
        真实鼠标模式需游戏窗口位于前台且棋盘不被遮挡。首次操作可能需在
        系统设置 → 隐私与安全性 → 辅助功能/屏幕录制 中授权终端或浏览器。
      </p>

      <div v-if="autoStore.nextTask" class="p-3 border rounded-md flex items-center gap-3">
        <UIcon
          :name="autoStore.nextTask.type === 'move' ? 'i-lucide:move' : 'i-lucide:bomb'"
          class="size-5 shrink-0"
          :class="autoStore.nextTask.type === 'move' ? 'text-sky-500' : 'text-green-500'"
        />
        <span class="text-sm w-20 shrink-0">{{ autoStore.nextTask.type === 'move' ? '下一步拖拽' : '下一步点消' }}</span>
        <img :src="'/icons/' + autoStore.nextTask.value + '.png'" class="inline-block size-8 shrink-0" alt="" />
        <code class="text-gray-400 text-sm">
          <template v-if="autoStore.nextTask.type === 'move'">
            (R{{ autoStore.nextTask.from.r + 1 }},C{{ autoStore.nextTask.from.c + 1 }}) → (R{{
              autoStore.nextTask.to.r + 1
            }},C{{ autoStore.nextTask.to.c + 1 }})
          </template>
          <template v-else>
            (R{{ autoStore.nextTask.p1.r + 1 }},C{{ autoStore.nextTask.p1.c + 1 }}) + (R{{
              autoStore.nextTask.p2.r + 1
            }},C{{ autoStore.nextTask.p2.c + 1 }})
          </template>
        </code>
      </div>

      <div class="flex items-center gap-3">
        <span class="text-sm text-gray-500">
          进度: 第 {{ Math.min(autoStore.queueIndex + 1, autoStore.tasks.length) }} / {{ autoStore.tasks.length }} 步
          <span v-if="autoStore.finished" class="text-green-500">(已全部执行)</span>
        </span>
        <span v-if="autoStore.executing" class="text-sm text-sky-500">执行中…</span>
      </div>

      <p v-if="autoStore.lastError" class="text-sm text-red-500">{{ autoStore.lastError }}</p>

      <p v-if="!autoStore.available" class="text-sm text-gray-400">
        {{
          gridStore.captureImageSize
            ? '暂无可执行的步骤 (需先完成自动求解)'
            : '请先选择小程序窗口并点击"抓取窗口并识别"加载棋盘'
        }}
      </p>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { useAutoControlStore } from '~/stores/autoControl';
import { useGridStore } from '~/stores/grid';
import { useReplayStore } from '~/stores/replay';

const gridStore = useGridStore();
const replayStore = useReplayStore();
const autoStore = useAutoControlStore();

interface WinInfo {
  windowId: number;
  pid: number;
  owner: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
const windows = ref<WinInfo[]>([]);
const windowsLoading = ref(false);
const windowLabel = ref('');

const windowOptions = computed(() =>
  windows.value.map(
    win => `${win.owner} - ${win.title || '(无标题)'} [${win.w}x${win.h}] #${win.windowId}`
  )
);

async function loadWindows() {
  windowsLoading.value = true;
  try {
    const res = await $fetch<{ windows: WinInfo[] }>('/api/win/list');
    // 过滤掉无尺寸的窗口; 微信/小程序相关排前面
    windows.value = res.windows
      .filter(win => win.w > 100 && win.h > 100)
      .sort((a, b) => score(b) - score(a));
    if (gridStore.windowTarget) {
      const cur = windows.value.find(win => win.windowId === gridStore.windowTarget);
      if (cur) windowLabel.value = labelOf(cur);
    }
  } catch (err: any) {
    console.error('窗口列表获取失败', err);
  } finally {
    windowsLoading.value = false;
  }
}
function score(win: WinInfo) {
  const s = (win.owner + win.title).toLowerCase();
  if (s.includes('砖了个砖') || s.includes('zhuanglegezhuan')) return 100;
  if (s.includes('微信') || s.includes('wechat') || s.includes('weixin')) return 50;
  return 0;
}
function labelOf(win: WinInfo) {
  return `${win.owner} - ${win.title || '(无标题)'} [${win.w}x${win.h}] #${win.windowId}`;
}
function onWindowSelect(label: string) {
  const win = windows.value.find(w => labelOf(w) === label);
  gridStore.windowTarget = win?.windowId ?? null;
  if (win) autoStore.inputMode = 'window';
}

// 窗口模式下始终展示卡片
const showCard = computed(() => !!gridStore.windowTarget || !!gridStore.captureImageSize);

// 棋盘/求解结果变化(步骤被重置)时, 重置任务队列
watch(
  () => replayStore.steps.length,
  () => autoStore.reset()
);

const intervalOptions = ['慢 (1.5s)', '普通 (0.8s)', '快 (0.4s)'];
const intervalLabel = ref(intervalOptions[1]);
const intervalMap: Record<string, number> = {
  '慢 (1.5s)': 1500,
  '普通 (0.8s)': 800,
  '快 (0.4s)': 400,
};
watch(
  intervalLabel,
  label => {
    autoStore.intervalMs = intervalMap[label] ?? 800;
  },
  { immediate: true }
);

onMounted(() => loadWindows());
</script>
