// Periodic background refresh (iOS decides the actual timing, roughly hourly at best).
// defineTask must run at module load (before React renders): iOS can launch the
// app headless just to run the task, and the task must already be known then.
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { refreshAndReplan } from "./refresh";

export const BACKGROUND_TASK = "nz.sewell.weathertempo.refresh";

if (Platform.OS !== "web" && !TaskManager.isTaskDefined(BACKGROUND_TASK)) {
  TaskManager.defineTask(BACKGROUND_TASK, async () => {
    await refreshAndReplan("background");
    return BackgroundTask.BackgroundTaskResult.Success;
  });
}

export async function setUpBackground(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 60 });
  } catch (e) {
    console.warn("[WeatherTempo] Background refresh unavailable:", (e as Error).message);
  }
}
