# Blender's side of `openfilm stage render --engine blender`: a shot baked to glTF (bake.mjs) imported with Blender's
# own glTF importer, its sidecar applied (what glTF has no place for), saved as a .blend and rendered frame by frame.
#
#   blender -b --factory-startup -P import.py -- <base> <frames dir> <eevee|cycles> <samples> <width> <height>
#
# <base>.glb and <base>.json are the bake; frames go to <frames dir>/f0001.png… (`-`: the .blend only, nothing
# rendered; frames already there are kept, so a
# render stopped part way goes on where it was). It prints `PROGRESS <done> <total>` after each frame and `DONE` last.
import json
import math
import os
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
base, frames_dir, engine, samples, width, height = args[0], args[1], args[2], int(args[3]), int(args[4]), int(args[5])
side = json.load(open(base + '.json'))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = side['fps']
# three.js's light units read as Blender's: a sun's intensity as W/m², a point light's (candela) times 4π as watts
bpy.ops.import_scene.gltf(filepath=base + '.glb', export_import_convert_lighting_mode='COMPAT', merge_vertices=True, import_scene_extras=True)

# three.js's shadow flags, carried as extras
for ob in scene.objects:
    if 'castShadow' in ob:
        if ob.type == 'LIGHT':
            ob.data.use_shadow = bool(ob['castShadow'])
        else:
            ob.visible_shadow = bool(ob['castShadow'])
    for child in ob.children:
        if child.type == 'MESH' and 'castShadow' in ob and 'castShadow' not in child:
            child.visible_shadow = bool(ob['castShadow'])

# where the importer put the shot's first frame
starts = sorted({round(ob.animation_data.action.frame_range[0]) for ob in scene.objects if ob.animation_data and ob.animation_data.action})
first = starts[0] if starts else 0
scene.frame_start, scene.frame_end = first, first + side['frames'] - 1
scene.render.resolution_x, scene.render.resolution_y = width, height
scene.render.resolution_percentage = 100

camera = scene.objects.get(side['camera']) or next((o for o in scene.objects if o.type == 'CAMERA'), None)
if camera is None:
    raise SystemExit('the shot has no camera')
scene.camera = camera
camera.data.sensor_fit = 'VERTICAL'
camera.data.sensor_height = 24
for i, fov in enumerate(side['fov']):
    camera.data.lens = 12 / math.tan(math.radians(fov) / 2)
    camera.data.keyframe_insert('lens', frame=first + i)

# the light from everywhere: the stage's sky above, its ground below, blended across the horizon as three.js's
# environment is; what the camera sees behind the set is the page's background color
world = bpy.data.worlds.new('world')
scene.world = world
world.use_nodes = True
nodes, links = world.node_tree.nodes, world.node_tree.links
nodes.clear()
out = nodes.new('ShaderNodeOutputWorld')
light = nodes.new('ShaderNodeBackground')
sky = side.get('sky')
if sky:
    coords = nodes.new('ShaderNodeTexCoord')
    split = nodes.new('ShaderNodeSeparateXYZ')
    ramp = nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value, ramp.inputs['From Max'].default_value = -0.25, 0.25
    ramp.interpolation_type = 'SMOOTHSTEP'
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    links.new(coords.outputs['Generated'], split.inputs[0])
    links.new(split.outputs['Z'], ramp.inputs['Value'])
    socket = lambda sockets, name: next(x for x in sockets if x.identifier == name)
    links.new(ramp.outputs['Result'], socket(mix.inputs, 'Factor_Float'))
    socket(mix.inputs, 'A_Color').default_value = (*sky['ground'], 1)
    socket(mix.inputs, 'B_Color').default_value = (*sky['sky'], 1)
    links.new(socket(mix.outputs, 'Result_Color'), light.inputs['Color'])
    light.inputs['Strength'].default_value = sky['intensity']
else:
    light.inputs['Strength'].default_value = 0
if side.get('background'):
    behind = nodes.new('ShaderNodeBackground')
    behind.inputs['Color'].default_value = (*side['background'], 1)
    path = nodes.new('ShaderNodeLightPath')
    pick = nodes.new('ShaderNodeMixShader')
    links.new(path.outputs['Is Camera Ray'], pick.inputs[0])
    links.new(light.outputs[0], pick.inputs[1])
    links.new(behind.outputs[0], pick.inputs[2])
    links.new(pick.outputs[0], out.inputs[0])
else:
    links.new(light.outputs[0], out.inputs[0])

# three.js's AgX, which is Blender's
scene.view_settings.view_transform = 'AgX'
if engine == 'cycles':
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type != 'CPU']
        if gpus:
            # the graphics chip alone: with the processor beside it, an Apple chip renders slower
            for d in prefs.devices:
                d.use = d.type != 'CPU'
            scene.cycles.device = 'GPU'
            break
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
else:
    scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE_NEXT'
    scene.eevee.taa_render_samples = samples
    try:
        scene.eevee.use_raytracing = True
    except AttributeError:
        pass

scene.render.image_settings.file_format = 'PNG'
scene.render.use_overwrite = False
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(base), 'shot.blend'))
if frames_dir == '-':
    # the scene alone, not rendered
    print('DONE', flush=True)
    sys.exit(0)

total = side['frames']
for i in range(total):
    target = os.path.join(frames_dir, 'f%04d.png' % (i + 1))
    if not os.path.exists(target):
        scene.frame_set(first + i)
        scene.render.filepath = target
        bpy.ops.render.render(write_still=True)
    print('PROGRESS %d %d' % (i + 1, total), flush=True)
print('DONE', flush=True)
