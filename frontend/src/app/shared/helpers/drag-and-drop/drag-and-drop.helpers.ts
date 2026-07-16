export function findIndex(el:HTMLElement):number {
  if (!el.parentElement) {
    return -1;
  }

  const children = Array.from(el.parentElement.children);
  return children.indexOf(el);
}

export function reinsert(el:HTMLElement, previousIndex:number|string, container:HTMLElement) {
  const prev = typeof previousIndex === 'string' ? parseInt(previousIndex, 10) : previousIndex;
  const children = Array.from(container.children);
  // Only meaningful when `el` still lives in `container` (same-list revert):
  // a cross-list reject can leave `el` sitting in the target container while
  // we restore it into the source, in which case its index there says
  // nothing about where `prev` points inside `container`.
  const currentIndex = el.parentNode === container ? children.indexOf(el) : -1;

  const pointOfInsertion = (() => {
    if (currentIndex >= 0) {
      const isDraggingDown = currentIndex > prev;
      return isDraggingDown ? children[prev] : children[prev + 1];
    }

    return children[prev];
  })();

  if (pointOfInsertion) {
    container.insertBefore(el, pointOfInsertion);
  } else {
    container.appendChild(el);
  }
}
