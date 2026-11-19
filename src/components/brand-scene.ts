import {
  AmbientLight,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
  Vector3,
} from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import symbol from "../../assets/branding/brand-kit-v1/01-logos/svg/awb-symbol-orange.svg?raw";

export function mountBrandScene(host: HTMLElement): () => void {
  const button = host.closest("button");
  if (!button) return () => {};
  const geometries: ExtrudeGeometry[] = [];
  const materials: MeshStandardMaterial[] = [];
  let renderer: WebGLRenderer | undefined;
  let frame = 0;
  let blinkTimer = 0;
  let blinkStarted = 0;
  let stopped = false;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const eyes: { mesh: Mesh; center: Vector3 }[] = [];
  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  const scene = new Scene();
  const model = new Group();
  const camera = new OrthographicCamera(-570, 570, 570, -570, 1, 4000);
  camera.position.z = 2000;

  function release() {
    cancelAnimationFrame(frame);
    clearTimeout(blinkTimer);
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    renderer?.dispose();
    renderer?.domElement.remove();
    delete host.dataset.rendered;
  }

  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    const orange = new MeshStandardMaterial({
      color: "#ff791f",
      roughness: 0.34,
      metalness: 0.08,
    });
    const ivory = new MeshStandardMaterial({
      color: "#fff4df",
      roughness: 0.52,
    });
    materials.push(orange, ivory);
    const paths = new SVGLoader().parse(symbol).paths;
    for (const path of paths) {
      for (const shape of path.toShapes()) {
        const geometry = new ExtrudeGeometry(shape, {
          depth: 65,
          bevelEnabled: true,
          bevelThickness: 12,
          bevelSize: 9,
          bevelSegments: 3,
          steps: 1,
          curveSegments: 16,
        });
        geometries.push(geometry);
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox!;
        const center = bounds.getCenter(new Vector3());
        const isEye =
          bounds.max.x - bounds.min.x < 270 &&
          bounds.max.y - bounds.min.y < 200;
        geometry.translate(-627.5, -632, 0);
        const mesh = new Mesh(geometry, orange);
        model.add(mesh);
        if (isEye) {
          center.x -= 627.5;
          center.y -= 632;
          geometry.translate(-center.x, -center.y, 0);
          eyes.push({ mesh, center });
        } else {
          // The original outline forms a recessed ivory face behind the orange cutouts.
          const backingShape = shape.clone();
          backingShape.holes = [];
          const backing = new ExtrudeGeometry(backingShape, {
            depth: 40,
            bevelEnabled: true,
            bevelThickness: 14,
            bevelSize: 12,
            bevelSegments: 3,
            steps: 1,
            curveSegments: 16,
          });
          geometries.push(backing);
          backing.translate(-627.5, -632, -35);
          model.add(new Mesh(backing, ivory));
        }
      }
    }
    model.scale.y = -1;
    scene.add(model, new AmbientLight(0xffffff, 2));
    const key = new DirectionalLight(0xffffff, 3);
    key.position.set(-500, 800, 1400);
    scene.add(key);
    host.append(renderer.domElement);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    host.dataset.rendered = "true";
  } catch {
    // WebGL is optional: retain the original logo on unsupported devices.
    release();
    return () => {};
  }

  function render() {
    frame = 0;
    if (stopped || document.hidden) return;
    const easing = motion.matches ? 1 : 0.18;
    current.x += (target.x - current.x) * easing;
    current.y += (target.y - current.y) * easing;
    model.rotation.set(-0.08 + current.y * 0.2, -0.12 + current.x * 0.25, 0);
    const elapsed = blinkStarted ? performance.now() - blinkStarted : Infinity;
    const blinking = !motion.matches && elapsed < 240;
    const openness = blinking ? Math.max(0.05, Math.abs(1 - elapsed / 120)) : 1;
    if (blinkStarted && !blinking) {
      blinkStarted = 0;
      queueBlink();
    }
    for (const { mesh, center } of eyes) {
      mesh.position.set(
        center.x + current.x * 32,
        center.y + current.y * 24,
        4,
      );
      mesh.scale.y = openness;
    }
    renderer!.render(scene, camera);
    if (
      blinking ||
      Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.002
    )
      frame = requestAnimationFrame(render);
  }
  function queueBlink() {
    clearTimeout(blinkTimer);
    if (stopped || motion.matches || document.hidden) return;
    blinkTimer = window.setTimeout(() => {
      blinkStarted = performance.now();
      schedule();
    }, 5000);
  }
  function motionChanged() {
    blinkStarted = 0;
    queueBlink();
    reset();
  }
  function schedule() {
    if (!frame && !stopped) frame = requestAnimationFrame(render);
  }
  function move(event: PointerEvent) {
    if (motion.matches || event.pointerType === "touch") return;
    const bounds = button!.getBoundingClientRect();
    target.x = Math.max(
      -1,
      Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1),
    );
    target.y = Math.max(
      -1,
      Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1),
    );
    schedule();
  }
  function reset() {
    target.x = target.y = 0;
    schedule();
  }
  function resize() {
    renderer!.setSize(host.clientWidth, host.clientHeight);
    schedule();
  }
  function contextLost(event: Event) {
    event.preventDefault();
    stopped = true;
    clearTimeout(blinkTimer);
    cancelAnimationFrame(frame);
    delete host.dataset.rendered;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  button.addEventListener("pointermove", move);
  button.addEventListener("pointerleave", reset);
  button.addEventListener("blur", reset);
  motion.addEventListener("change", motionChanged);
  document.addEventListener("visibilitychange", motionChanged);
  resize();
  queueBlink();
  return () => {
    stopped = true;
    observer.disconnect();
    button.removeEventListener("pointermove", move);
    button.removeEventListener("pointerleave", reset);
    button.removeEventListener("blur", reset);
    motion.removeEventListener("change", motionChanged);
    document.removeEventListener("visibilitychange", motionChanged);
    renderer!.domElement.removeEventListener("webglcontextlost", contextLost);
    release();
  };
}
