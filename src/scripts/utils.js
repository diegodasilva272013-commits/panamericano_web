import imagesLoaded from "imagesloaded";
export const preloadImages = (selector = "img") => new Promise((resolve) => { imagesLoaded(document.querySelectorAll(selector), { background: true }, resolve); });
