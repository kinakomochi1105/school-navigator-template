import { pageState } from "./pageState";

function first() {
  localStorage.setItem("dp-first", "");
  pageState.page = "help";
}

function checkFirst() {
  return typeof localStorage.getItem("dp-first") !== "string";
}

export function checkAndDoFirst() {
  if (checkFirst()) first();
}
