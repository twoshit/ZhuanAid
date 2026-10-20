<template>
  <UCard v-if="replayStore.canReplay" :ui="{ divide: 'divide-y divide-gray-100 dark:divide-gray-800' }">
    <template #header>
      <div class="flex justify-between items-center gap-3">
        <h2 class="text-2xl flex items-end shrink-0">
          <span>步骤回放</span>
          <code class="ml-1 text-sm text-green-500">({{ replayStore.steps.length }})</code>
        </h2>
        <div class="flex gap-2 items-center flex-wrap justify-end">
          <span v-if="gridStore.autoRunning" class="text-sm text-amber-500">自动求解中…</span>
          <USelect v-model="intervalLabel" :options="intervalOptions" size="xs" class="w-28" :disabled="replayStore.playing || gridStore.autoRunning" />
          <UButton
            v-if="!replayStore.active"
            icon="i-lucide:play"
            color="green"
            :disabled="gridStore.autoRunning"
            @click="replayStore.play(interval)"
          >
            回放
          </UButton>
          <template v-else>
            <UButton v-if="!replayStore.playing" icon="i-lucide:play" color="green" @click="replayStore.play(interval)">
              播放
            </UButton>
            <UButton v-else icon="i-lucide:pause" color="amber" @click="replayStore.pause()">暂停</UButton>
            <UButton
              icon="i-lucide:step-back"
              color="gray"
              variant="ghost"
              :disabled="replayStore.currentIndex <= -1"
              @click="replayStore.prev()"
            >
              上一步
            </UButton>
            <UButton
              icon="i-lucide:step-forward"
              color="gray"
              variant="ghost"
              :disabled="replayStore.currentIndex >= replayStore.steps.length - 1"
              @click="replayStore.next(interval)"
            >
              下一步
            </UButton>
            <UButton icon="i-lucide:x" color="red" variant="ghost" @click="replayStore.exit()">退出</UButton>
          </template>
        </div>
      </div>
    </template>

    <p v-if="replayStore.active" class="text-sm text-gray-500 mb-3">
      当前第 {{ replayStore.currentIndex + 1 }} / {{ replayStore.steps.length }} 步
      <span v-if="replayStore.currentIndex === -1">(初始棋盘)</span>
    </p>

    <section class="space-y-3">
      <div
        v-for="(step, idx) in replayStore.steps"
        :key="idx"
        class="relative p-3 border rounded-md transition"
        :class="
          idx === replayStore.currentIndex
            ? 'ring-2 ring-green-500 bg-green-500/10'
            : gridStore.autoRunning
              ? ''
              : 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800'
        "
        @click="onStepClick(idx)"
      >
        <code class="absolute right-2 top-2 text-sm text-gray-500">#{{ idx + 1 }}</code>
        <div class="flex items-center gap-3">
          <UIcon
            :name="step.type === 'move' ? 'i-lucide:move' : 'i-lucide:bomb'"
            class="size-5 shrink-0"
            :class="step.type === 'move' ? 'text-sky-500' : 'text-green-500'"
          />
          <span class="text-sm w-16 shrink-0">{{ step.type === 'move' ? '移动消除' : '立即消除' }}</span>
          <img :src="'/icons/' + step.value + '.png'" class="inline-block size-8 shrink-0" alt="" />
          <code class="text-gray-400 text-sm">
            (R{{ step.area.point1.r + 1 }},C{{ step.area.point1.c + 1 }})-(R{{ step.area.point2.r + 1 }},C{{
              step.area.point2.c + 1
            }})
          </code>
        </div>
      </div>
    </section>
  </UCard>
</template>

<script setup lang="ts">
import { useGridStore } from '~/stores/grid';
import { useReplayStore } from '~/stores/replay';

const gridStore = useGridStore();
const replayStore = useReplayStore();

function onStepClick(idx: number) {
  if (gridStore.autoRunning) return;
  replayStore.jumpTo(idx);
}

const intervalOptions = ['慢速 (1.5s)', '普通 (0.8s)', '快速 (0.4s)'];
const intervalLabel = ref(intervalOptions[1]);
const intervalMap: Record<string, number> = {
  '慢速 (1.5s)': 1500,
  '普通 (0.8s)': 800,
  '快速 (0.4s)': 400,
};
const interval = computed(() => intervalMap[intervalLabel.value] ?? 800);
</script>
