<template>
  <div>
    <!-- 打开设置 -->
    <UButton
      icon="i-lucide:sliders-horizontal"
      class="fixed right-5 top-5"
      color="gray"
      variant="ghost"
      @click="open = true"
    ></UButton>

    <USlideover v-model="open" :ui="{ width: 'max-w-[500px]', overlay: { background: 'bg-black/60' } }">
      <UCard :ui="{ divide: 'divide-y divide-gray-100 dark:divide-gray-800' }">
        <template #header>
          <div class="flex justify-between items-center">
            <h2 class="font-bold text-2xl">游戏设置</h2>
            <UButton icon="i-lucide:x" color="gray" @click="open = false" variant="ghost"></UButton>
          </div>
        </template>

        <div class="h-[calc(100vh-121px)] overflow-y-scroll">
          <div class="space-y-3 my-3 border rounded-md p-3">
            <h2 class="text-xl text-sky-500 font-medium">加载棋盘数据</h2>

            <div class="flex gap-10">
              <label>
                <span class="mr-2">棋盘行数:</span>
                <UInput v-model="settingStore.rows" type="number" min="1" class="w-20 inline-block" />
              </label>
              <label>
                <span class="mr-2">棋盘列数:</span>
                <UInput v-model="settingStore.cols" type="number" min="1" class="w-20 inline-block" />
              </label>
            </div>

            <div class="flex gap-10">
              <label>
                <span>裁剪区域预设:</span>
                <USelect
                  class="w-64"
                  v-model="settingStore.model"
                  :options="BOARD_REGIONS"
                  option-attribute="name"
                  value-attribute="id"
                />
              </label>
            </div>
            <p class="text-xs text-gray-400">加载时会自动检测棋盘位置，自适应任意分辨率与机型；检测失败时回退到所选预设比例。</p>

            <div class="flex gap-10">
              <label>
                <span>选择棋盘截图文件:</span>
                <UInput
                  type="file"
                  size="sm"
                  icon="i-heroicons-folder"
                  class="w-64"
                  accept="image/*"
                  @change="handleFileChange"
                />
              </label>
            </div>

            <div class="flex gap-10">
              <UButton
                @click="processBoard"
                :loading="gridStore.loading"
                :disabled="!file"
                color="sky"
                class="disabled:bg-gray-400"
              >
                {{ gridStore.phase || '重置棋盘' }}
              </UButton>
            </div>

            <div v-if="isLocal" class="border-t pt-3">
              <div class="flex gap-4 items-center">
                <UButton @click="handleCapture" :loading="capturing" color="emerald" variant="outline">
                  抓取屏幕并识别
                </UButton>
                <span class="text-xs text-gray-400">直接抓取 Mac 主显示器, 自动定位游戏棋盘 (需要"屏幕录制"权限)</span>
              </div>
            </div>
          </div>

          <div class="space-y-3 my-3 border rounded-md p-3">
            <h2 class="text-xl text-sky-500 font-medium">显示设置</h2>
            <div class="flex flex-col gap-3">
              <UCheckbox v-model="settingStore.showRowColNumber" label="显示行列号" />
              <UCheckbox v-model="settingStore.showCellValue" label="显示网格值" />
              <URadioGroup
                v-model="settingStore.speed"
                legend="自动走步速度"
                :options="options"
                :ui="{ fieldset: 'flex gap-10 flex-1' }"
              />
            </div>
          </div>

          <MaterialLibrary class="my-3" />
        </div>
      </UCard>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import toastFactory from '~/composables/toast';
import { BOARD_REGIONS } from '~/config';
import { useGridStore } from '~/stores/grid';
import { useSettingStore } from '~/stores/setting';

const settingStore = useSettingStore();
const gridStore = useGridStore();
// 整屏抓取只能抓本机(Mac)屏幕, 局域网其他设备隐藏该入口
const isLocal = isLocalClient();

const options = [
  {
    value: 'fast',
    label: '快',
  },
  {
    value: 'slow',
    label: '慢',
  },
];

const open = ref(false);
const file = ref<File | null>(null);

function handleFileChange(files: FileList) {
  if (files.length > 0) {
    file.value = files[0];
    processBoard();
  } else {
    file.value = null;
  }
}

async function processBoard() {
  open.value = false;
  await gridStore.load(file.value!);
}

const capturing = ref(false);

interface PreflightResult {
  screencapture: boolean;
  screenRecording: boolean;
  dragBinary: boolean;
  messages: string[];
}

async function handleCapture() {
  capturing.value = true;
  const toast = toastFactory();
  try {
    const pf = await $fetch<PreflightResult>('/api/preflight');
    if (!pf.screencapture || !pf.screenRecording) {
      toast.error(
        '未检测到屏幕录制权限',
        '请打开 系统设置 → 隐私与安全性 → 屏幕录制, 勾选运行 yarn dev 的终端/IDE 进程, 重启开发服务器后重试。'
      );
      return;
    }
    if (!pf.dragBinary) {
      toast.error('鼠标助手不可用', '自动操作功能无法使用 (clang 编译失败), 屏幕识别仍可正常使用。');
    }
    open.value = false;
    await gridStore.captureScreen();
  } catch (error: any) {
    toast.error('环境自检失败', error?.statusMessage ?? error?.message ?? String(error));
  } finally {
    capturing.value = false;
  }
}
</script>
