<template>
  <div class="relative flex-1 h-[800px] overflow-y-scroll border rounded-md shadow-md">
    <div class="flex flex-col gap-5 p-10 pr-20">
      <EliminateCard />
      <MoveCard />
      <Replay />
    </div>
  </div>
</template>

<script setup lang="ts">
import EliminateCard from '~/components/EliminateCard.vue';
import MoveCard from '~/components/MoveCard.vue';
import Replay from '~/components/Replay.vue';
</script>
