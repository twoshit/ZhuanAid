<template>
  <div class="relative w-fit flex flex-col border rounded-md shadow-md">
    <!-- 顶部列序号 -->
    <BoardColNo :cols="gridStore.cols" position="top" />

    <div v-for="(row, rowIndex) in displayGrid" :key="rowIndex" class="flex">
      <!-- 左侧行序号 -->
      <BoardRowNo :index="rowIndex" position="left" />

      <!-- 格子区 -->
      <div
        v-for="(cell, colIndex) in row"
        :key="colIndex"
        class="tile relative z-0 size-10 ring-green-500 transition"
        :class="cellDivCls(cell)"
        :data-r="rowIndex"
        :data-c="colIndex"
      >
        <img :src="'/icons/' + cell + '.png'" class="size-10" :class="cellImageCls(cell)" alt="" />
        <code
          v-if="cell !== 0 && settingStore.showCellValue"
          class="absolute z-20 right-0 top-0 w-5 text-center text-white bg-black/80 p-[2px] text-xs"
        >
          {{ cell }}
        </code>
      </div>

      <!-- 右侧行序号 -->
      <BoardRowNo :index="rowIndex" position="right" />
    </div>

    <div v-if="gridStore.loading" class="absolute z-50 inset-0 flex flex-col justify-center items-center">
      <img src="/icons/20.png" alt="" class="animate-bounce-1 size-10" />
      <p class="text-gray-200">
        <span>棋盘加载中</span>
        <span v-if="gridStore.phase">({{ gridStore.phase }})</span>
      </p>
    </div>

    <!-- 底部列序号 -->
    <BoardColNo :cols="gridStore.cols" position="bottom" />
  </div>
</template>

<script setup lang="ts">
import BoardColNo from '~/components/widgets/BoardColNo.vue';
import BoardRowNo from '~/components/widgets/BoardRowNo.vue';
import { useGridStore } from '~/stores/grid';
import { useReplayStore } from '~/stores/replay';
import { useSettingStore } from '~/stores/setting';

const gridStore = useGridStore();
const replayStore = useReplayStore();
const settingStore = useSettingStore();

// 回放模式下展示棋盘快照, 否则展示实时棋盘
const displayGrid = computed(() => replayStore.currentGrid ?? gridStore.grid);

function cellImageCls(cell: number) {
  return cell === 0 ? '' : 'border border-black';
}
function cellDivCls(cell: number) {
  return cell === 0 ? '' : 'hover:ring-4 hover:cursor-pointer hover:z-10 hover:scale-110';
}
</script>
