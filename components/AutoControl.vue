<template>
  <UCard v-if="showCard" :ui="{ divide: 'divide-y divide-gray-100 dark:divide-gray-800' }">
    <template #header>
      <div class="flex justify-between items-center gap-3">
        <h2 class="text-2xl flex items-end shrink-0">
          <span>自动操作</span>
          <code class="ml-1 text-sm text-purple-500">(鼠标拖拽)</code>
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
      <p class="text-sm text-amber-600">
        执行前请确保微信小游戏窗口位于前台、棋盘完整可见且不被遮挡；首次操作可能需要授权
        系统设置 → 隐私与安全性 → 辅助功能。仅支持主显示器。
      </p>

      <div class="flex items-center gap-4 flex-wrap">
        <URadioGroup
          v-model="autoStore.mode"
          :options="[
            { value: 'step', label: '逐步确认' },
            { value: 'auto', label: '全自动' },
          ]"
          :ui="{ fieldset: 'flex gap-6 flex-1' }"
          size="sm"
        />
        <span class="text-sm text-gray-500">
          进度: 第 {{ Math.min(autoStore.queueIndex + 1, autoStore.tasks.length) }} / {{ autoStore.tasks.length }} 次拖拽
          <span v-if="autoStore.finished" class="text-green-500">(已全部执行)</span>
        </span>
      </div>

      <div v-if="autoStore.nextTask" class="p-3 border rounded-md flex items-center gap-3">
        <UIcon name="i-lucide:move" class="size-5 shrink-0 text-sky-500" />
        <span class="text-sm w-20 shrink-0">下一步拖拽</span>
        <img :src="'/icons/' + autoStore.nextTask.value + '.png'" class="inline-block size-8 shrink-0" alt="" />
        <code class="text-gray-400 text-sm">
          (R{{ autoStore.nextTask.from.r + 1 }},C{{ autoStore.nextTask.from.c + 1 }}) → (R{{
            autoStore.nextTask.to.r + 1
          }},C{{ autoStore.nextTask.to.c + 1 }})
        </code>
      </div>

      <p v-if="autoStore.lastError" class="text-sm text-red-500">{{ autoStore.lastError }}</p>

      <p v-if="!autoStore.available" class="text-sm text-gray-400">
        {{
          gridStore.captureImageSize
            ? '暂无可执行的拖拽步骤 (需先完成自动求解)'
            : '当前为手动上传模式, 无法自动操作; 请使用"抓取屏幕并识别"加载棋盘'
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

// 屏幕抓取模式下始终展示卡片 (便于用户了解为何不可用)
const showCard = computed(() => !!gridStore.captureImageSize);

// 棋盘/求解结果变化(步骤被重置)时, 重置拖拽队列
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
</script>
