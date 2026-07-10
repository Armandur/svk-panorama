#!/usr/bin/env python3
"""Generera multires-tiles for en hel panoramatur och skriv en tiled turfil.

Wrappar pannellums generate.py via Docker-imagen `pannellum-multires`
(bygg den fran pannellum/utils/multires/Dockerfile). Kraver ingen lokal
nona/Hugin-installation.

For varje scen med `type: equirectangular` + `panorama` genereras tiles till
<turmapp>/tiles/<sceneId>/ och scenen skrivs om till `type: multires` med ett
`multiRes`-block som pekar pa de genererade kaklen. Originalturfilen lamnas
orord; resultatet hamnar i <tur>.tiled.json (eller --output).

Anvandning:
    python3 tools/tile_tour.py images/vi/vifg/vifg.json
    python3 tools/tile_tour.py images/vi/vifg/vifg.json --only 1,2 --quality 80
"""

import argparse
import json
import os
import subprocess
import sys

DOCKER_IMAGE = "pannellum-multires"


def _repo_root():
    # tools/ ligger direkt under repo-roten
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _web_to_fs(web_path, root):
    """Oversatt en web-absolut panorama-sokvag (/images/...) till en filsystemsvag."""
    return os.path.join(root, web_path.lstrip("/"))


def _run_docker(image_fs, out_fs, quality):
    """Kor generate.py i Docker och lagg resultatet i out_fs. Returnerar config-dicten."""
    image_dir = os.path.dirname(image_fs)
    image_name = os.path.basename(image_fs)
    out_parent = os.path.dirname(out_fs)
    out_name = os.path.basename(out_fs)
    os.makedirs(out_parent, exist_ok=True)

    uid = os.getuid()
    gid = os.getgid()
    cmd = [
        "docker", "run", "--rm",
        "--user", f"{uid}:{gid}",
        "-v", f"{image_dir}:/in:ro",
        "-v", f"{out_parent}:/out",
        DOCKER_IMAGE,
        "--quality", str(quality),
        "--output", f"/out/{out_name}",
        f"/in/{image_name}",
    ]
    subprocess.run(cmd, check=True)

    with open(os.path.join(out_fs, "config.json"), encoding="utf-8") as fh:
        return json.load(fh)


def tile_tour(tour_json, output, only, quality):
    root = _repo_root()
    with open(tour_json, encoding="utf-8") as fh:
        tour = json.load(fh)

    tour_dir_fs = os.path.dirname(os.path.abspath(tour_json))
    # Web-sokvag till turmappen, t.ex. /images/vi/vifg
    tour_web = "/" + os.path.relpath(tour_dir_fs, root).replace(os.sep, "/")

    scenes = tour.get("scenes", {})
    wanted = set(only.split(",")) if only else None
    tiled_count = 0

    for scene_id, scene in scenes.items():
        if wanted and scene_id not in wanted:
            continue
        if scene.get("type") != "equirectangular" or "panorama" not in scene:
            continue

        image_fs = _web_to_fs(scene["panorama"], root)
        if not os.path.isfile(image_fs):
            print(f"  scen {scene_id}: HOPPAR OVER, saknar bild {image_fs}", file=sys.stderr)
            continue

        out_fs = os.path.join(tour_dir_fs, "tiles", scene_id)
        print(f"  scen {scene_id}: genererar tiles fran {os.path.basename(image_fs)} ...")
        config = _run_docker(image_fs, out_fs, quality)

        multires = config["multiRes"]
        # basePath = web-sokvag till scenens tile-mapp; pannellum bygger URL som basePath + path
        multires["basePath"] = f"{tour_web}/tiles/{scene_id}"

        scene["type"] = "multires"
        scene.pop("panorama", None)
        scene["multiRes"] = multires
        tiled_count += 1

    out_path = output or tour_json.rsplit(".json", 1)[0] + ".tiled.json"
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(tour, fh, ensure_ascii=False, indent="\t")
        fh.write("\n")

    print(f"\nKlart: {tiled_count} scener tilade. Skrev {out_path}")
    return out_path


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("tour_json", help="Sokvag till turens JSON, t.ex. images/vi/vifg/vifg.json")
    parser.add_argument("-o", "--output", help="Utfil (default: <tur>.tiled.json)")
    parser.add_argument("--only", help="Kommaseparerade scen-ID att tila (default: alla)")
    parser.add_argument("-q", "--quality", type=int, default=80, help="JPEG-kvalitet 1-100 (default 80)")
    args = parser.parse_args()

    if not os.path.isfile(args.tour_json):
        parser.error(f"hittar inte {args.tour_json}")
    tile_tour(args.tour_json, args.output, args.only, args.quality)


if __name__ == "__main__":
    main()
