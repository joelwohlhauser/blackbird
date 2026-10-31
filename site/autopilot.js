const timeline = document.querySelector(".timeline");
const tabs = [...timeline.querySelectorAll('[role="tab"]')];

function select(index) {
  tabs.forEach((tab, i) => {
    const active = i === index;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
  });
  timeline.style.setProperty("--step", index);
}

tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => select(i));
  tab.addEventListener("keydown", (event) => {
    const offset = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!offset) return;
    event.preventDefault();
    const next = (i + offset + tabs.length) % tabs.length;
    select(next);
    tabs[next].focus();
  });
});
