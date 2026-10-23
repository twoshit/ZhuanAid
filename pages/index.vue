<template>
  <div class="h-full">
    <div class="container mx-auto h-full p-10 flex gap-10 items-start">
      <CheckerBoard />
      <Solution />
    </div>
    <!--    <div class="animate-highlight size-20 bg-sky-500 fixed bottom-0 right-0 z-50"></div>-->

    <Settings />

    <UButton v-if="gridStore.autoRunning" class="fixed right-5 top-16" @click="gridStore.stop()">
      <UIcon name="i-lucide:loader" class="animate-spin" />
      <span>{{ gridStore.phase || '自动运行中，点击停止' }}</span>
    </UButton>
    <!-- 自动执行-->
    <UButton
      v-else
      icon="i-lucide:sparkles"
      @click="gridStore.magic()"
      color="gray"
      variant="ghost"
      class="fixed right-5 top-16"
    ></UButton>
  </div>
</template>

<script setup lang="ts">
import CheckerBoard from '~/components/CheckerBoard.vue';
import Solution from '~/components/Solution.vue';
import { websiteName } from '~/config';
import { useGridStore } from '~/stores/grid';

useHead({
  title: websiteName,
});

const gridStore = useGridStore();
</script>
