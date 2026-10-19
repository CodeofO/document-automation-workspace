


def image_inputs_from_paths(image_paths: list[str]) -> list[dict[str, str]]:
    return [{"path": image_path, "label": f"Full document page {index + 1}"} for index, image_path in enumerate(image_paths)]


