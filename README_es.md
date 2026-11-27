<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="AI Cut — un espacio de trabajo para editar video, local-first y operable por agentes">
</p>

<p align="center">
  <a href="https://github.com/heshengtao/ai-cut/releases"><img src="https://img.shields.io/github/v/release/heshengtao/ai-cut?style=flat-square&color=1A6CFF" alt="Lanzamiento de GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-1A6CFF?style=flat-square" alt="Licencia: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/platforms-Windows%20/%20macOS%20/%20Linux%20/%20Web-1A6CFF?style=flat-square" alt="Plataformas: Windows, macOS, Linux, Web">
  <a href="https://hub.docker.com/r/ailm32442/ai-cut"><img src="https://img.shields.io/docker/pulls/ailm32442/ai-cut?style=flat-square&color=1A6CFF" alt="Descargas de Docker"></a>
</p>

<p align="center">
  <a href="README_zh.md">简体中文</a> ·
  <a href="README_zh-TW.md">繁體中文</a> ·
  <a href="README.md">English</a> ·
  <a href="README_ja.md">日本語</a> ·
  <a href="README_ko.md">한국어</a> ·
  <a href="README_es.md"><b>Español</b></a> ·
  <a href="README_fr.md">Français</a> ·
  <a href="README_de.md">Deutsch</a> ·
  <a href="README_ru.md">Русский</a> ·
  <a href="README_ar.md">العربية</a>
</p>

<p align="center">
  <a href="https://hub.docker.com/r/ailm32442/ai-cut"><b>Docker Hub</b></a> ·
  <a href="https://github.com/heshengtao/ai-cut/releases">Descargar</a>
</p>

## ¿Qué es AI Cut?

**AI Cut es un editor de video pequeño y nativo de IA para tu escritorio** — cortar, subtitular, añadir voz, mezclar y exportar en una sola aplicación ligera, y dejar que un agente de IA trabaje contigo en la timeline.

Es un editor de verdad: una timeline multipista, **un canvas infinito para workflows basados en nodes**, **un grafo de episodios con ramificaciones**, una biblioteca de medios, un inspector, clips de texto, subtítulos, voz en off, herramientas de IA de audio y video, **plugins de efectos OpenFX (OFX)** y exportación a MP4, ProRes o GIF. La timeline, el canvas y el grafo de episodios son tres vistas del mismo proyecto. También está pensado para **ser operado por un modelo**: una Skill incluida enseña a cualquier harness de IA a manejar la aplicación en ejecución a través de MCP, de modo que un agente puede importar medios, añadir pistas, colocar y recortar clips, reescribir texto, construir un canvas o recablear una rama, y leer el proyecto de vuelta mientras ves la interfaz actualizarse.

Todo se ejecuta en tu propia máquina. Sin cuenta, sin subidas y sin clave de API para el editor en sí.

<p align="center">
  <img src="./assets/screenshots/00-editor.jpg" width="100%" alt="El espacio de trabajo de AI Cut con sus vistas Preview, Canvas y Episodes; una película de presentación de tres escenas descansa en la timeline con pistas de título, subtítulos y música, y el inspector de texto está abierto sobre un clip de título">
</p>

## Por qué esto importa

Los modelos se volvieron buenos escribiendo código porque podían **ejecutarlo** mediante un framework de agentes de código; los modelos se volvieron buenos en modelado 3D porque podían manejar software de modelado real a través de Blender MCP. En ambos casos el modelo obtiene una herramienta real, un resultado real y un bucle de retroalimentación real, y eso es lo que hace posible iterar rápido.

Al video le ha faltado casi siempre ese bucle. Un modelo puede generar un clip, pero no puede *trabajar sobre una timeline* como lo hace un editor: no hay disposición que editar, ni pistas que equilibrar, ni historial de deshacer, ni forma de darse cuenta de que su último corte empeoró las cosas.

**AI Cut es un intento pequeño y deliberado de cerrar esa brecha.** Es un editor real que un agente de IA puede operar mediante una Skill y MCP, lo que lo hace útil para:

- **Probar lo que un modelo sabe realmente sobre edición** — no si puede generar material, sino si puede construir una secuencia, elegir planos y corregir el ritmo.
- **Recopilar trazas de edición reales** — cada edición del agente aterriza en un proyecto normal con un historial de deshacer normal, así que una sesión se convierte en datos sobre cómo razona un modelo acerca del video.
- **Un paso hacia modelos capaces de editar video como escriben código** — con una timeline que responde.

## Ligero por diseño

Ser pequeño es una característica, no una concesión.

- **Una huella ligera** — sin Electron, sin nube, sin un zoológico de modelos empaquetado. La aplicación es una compilación de Tauri, y ffmpeg / ffprobe se distribuyen como sidecars estáticos, así que los usuarios no necesitan tener ffmpeg instalado.
- **Arranque rápido** — no se carga nada pesado al iniciar; los modelos de IA solo se cargan cuando los usas.
- **La IA pesada se queda donde corresponde** — la generación es deliberadamente externa. Tu harness de IA puede generar u obtener material y luego entregar los archivos a AI Cut para editarlos, subtitularlos, mezclarlos y exportarlos.
- **Diseñado para extenderse** — cada edición es un comando serializable, de modo que las nuevas operaciones de edición no necesitan una nueva CLI ni una nueva herramienta MCP; el canvas funciona con el mismo modelo de comandos, y las extensiones de la aplicación pueden añadir sus propios nodes, tipos de datos, paneles y comandos.
- **Gestor de plugins OFX** — el gestor de descargas administra los plugins OpenFX instalados / externos / disponibles, la búsqueda, la importación, las actualizaciones y la eliminación; el panel de plugins OFX abre la interfaz de un plugin instalado. Las entradas gratuitas/de código abierto provienen del [AI Cut OFX Registry](https://github.com/heshengtao/ai-cut-ofx-registry), con verificación SHA-256. Las entradas GPL/AGPL pueden descargarse desde el release del autor original, pero la aplicación nunca aloja ni empaqueta sus binarios. El host nativo (`crates/ofx-host`, CLI `ofx-host probe|render`) carga los bundles OFX 1.5.1 al tamaño de entrada y soporta los seis contextos de efecto de imagen: filter / general / generator / paint / retimer se enganchan a la cadena `effects[]` de un clip, mientras que transition se engancha al borde de un clip y se hornea como una capa a fotograma completo. Los parámetros viven en un panel Parameters dedicado. Montar un efecto inicia un pre-bake en segundo plano (con progreso) para que las vistas previas de video e imagen mantengan el efecto durante la reproducción; la exportación se hornea al tamaño final (paint se controla por parámetros; retimer pide el `SourceTime` al plugin).

## Controlarlo desde cualquier harness de IA

AI Cut incluye una **Skill** (`skills/aicut`) que enseña a un agente de IA cómo operar la aplicación en ejecución — leer y escribir el proyecto, importar medios, añadir pistas y clips, mover / recortar / dividir, cambiar texto y propiedades de clips, deshacer y rehacer, además de referencias de producción, storyboard, framework, revisión y assets que se cargan a demanda. Funciona sobre el servidor **MCP** integrado, de modo que cualquier harness que soporte Agent Skills puede usarla.

**Opción 1 · Instalar desde la línea de comandos**

```bash
npx skills add heshengtao/ai-cut
```

**Opción 2 · Pedir a tu agente que la instale**

```
Install this Skill: https://github.com/heshengtao/ai-cut
```

La aplicación también incluye `aicut`, un cliente MCP ligero que se puede instalar en tu `PATH` desde Configuración. La superficie de comandos es la superficie de herramientas:

```bash
aicut status
aicut tools
aicut call get_project
```

Cada edición que hace un agente pasa por el mismo canal de comandos que la interfaz: queda en el historial de deshacer, aparece en la interfaz y se atribuye al agente, así que siempre puedes ver qué hizo y deshacerlo.

## Funciones

### Edición en timeline — Componer sobre una timeline real

Ordena un video tal como lo escuchas. Arrastra clips entre pistas, divídelos donde cambia la historia, recorta los bordes y deja que el ajuste automático y la rejilla de fotogramas mantengan todo alineado. Los clips de video, audio, imagen y texto comparten la misma timeline, y cada edición es un comando en un único historial de deshacer.

- **Composición multipista** — clips de video, audio, imagen y texto uno al lado del otro; arrastrar y soltar entre pistas; selección por marco
- **Un kit de edición real** — mover, dividir, recortar, ajuste automático, rejilla de fotogramas
- **Deshacer que respeta los gestos** — los arrastres y los deslizadores se agrupan en un solo paso, así que deshacer vuelve al estado anterior al gesto
- **Sesiones seguras** — guardado automático, recuperación de borradores tras un cierre inesperado e historial del proyecto
- **Texto en la timeline** — clips de título y de subtítulo con estilos editables

<p align="center">
  <img src="./assets/screenshots/01-timeline.jpg" width="100%" alt="La timeline con tres escenas de video, pistas de título y subtítulos y una partitura musical; el clip seleccionado muestra controles de transformación, tiempo y color en el inspector">
</p>

### Medios e inspector — Leer el material, dar forma al plano

Importa un archivo y AI Cut lo analiza de inmediato: duración, resolución, frecuencia de fotogramas y audio. La biblioteca de medios muestra miniaturas y formas de onda; el inspector te da los parámetros que hay detrás del clip seleccionado, así que el encuadre, las capas y el sonido se editan en el sitio y no en un diálogo aparte.

- **Importación por arrastre** — metadatos de ffprobe, miniaturas, formas de onda y vistas previas en caché
- **Transformación** — posición, escala, rotación, opacidad, modos de fusión, radio de esquina
- **Audio por clip** — ganancia, fundidos, tono, balance estéreo, silencio
- **Estilo de texto** — fuente, tamaño, color, espaciado, fondo, trazo, sombra, resplandor
- **Salida del proyecto** — los cambios de resolución y frecuencia de fotogramas reajustan los clips de forma proporcional
- **Utilidades de entrega** — reunir los medios en `<project>-media/` junto al proyecto

<p align="center">
  <img src="./assets/screenshots/02-media.jpg" width="100%" alt="La biblioteca de medios con tres escenas de video, dos imágenes de póster y una partitura musical, además de miniaturas y metadatos">
</p>

### Canvas y workflows — Construir el plano antes de cortarlo

La vista Canvas es un canvas infinito de nodes para las partes de un video que es más fácil dibujar que arrastrar. Suelta un póster, un clip de referencia o una línea de texto en el canvas, conéctalo a un node de modelo o de visualización, ejecuta la cadena y envía el resultado a la parte actual.

- **Un proyecto, muchos canvas** — cada proyecto puede contener varios canvas con nombre; abre, renombra, duplica o vacía uno sin tocar la edición.
- **Un node para cada paso** — entradas de imagen / video / audio / texto / valor, visualizaciones y lecturas de valores, nodes de modelos locales y en la nube, límites de workflow, bucles y grupos.
- **Una entrada, una salida** — cada tarjeta expone un único cable de entrada y otro de salida; el inspector elige qué valor lógico transporta ese cable, así que un grafo puede reestructurarse sin recablear.
- **Ejecución en segundo plano** — ejecuciones manuales, al cambiar o repetidas con estado, progreso y tiempos en vivo; las salidas llegan a la biblioteca de medios y pueden insertarse en la parte actual con un clic.
- **Los workflows son reutilizables** — declara una firma de inicio/fin, guárdala en la biblioteca de workflows, publícala como API o llama a un canvas desde otro (anidado hasta 8 niveles).
- **Abierto a plugins** — las extensiones de la aplicación registran tipos de nodes, tipos de datos, paneles, controles y comandos; el mismo grafo se puede escribir de forma headless mediante las herramientas MCP de board.

Nota de diseño completa: [`docs/canvas-workflow.md`](docs/canvas-workflow.md) · guía de plugins: [`docs/plugins.md`](docs/plugins.md).

<p align="center">
  <img src="./assets/screenshots/07-canvas.jpg" width="100%" alt="El espacio de trabajo Canvas: un grafo de nodes infinito con una entrada de póster, una entrada de texto, un node de visualización y un límite de workflow, con el inspector de nodes abierto">
</p>

### Episodios y ramificaciones — Un proyecto, muchos cortes

Un proyecto no es un solo corte. Contiene muchas partes que comparten la misma biblioteca de medios y los mismos canvas, y el grafo de episodios decide qué parte se reproduce a continuación. Al final de una parte con ramificaciones, la vista previa se detiene en el último fotograma y convierte los bordes salientes en botones, así que una elección es una edición más.

- **Las partes comparten todo lo demás** — los medios, los canvas y la configuración son del proyecto; cada parte mantiene sus propias pistas y marcadores.
- **Dos formas de ver la historia** — vista de mosaico para una rejilla de storyboard, vista de flujo para un canvas libre con una tarjeta por parte.
- **Ramas reales, etiquetas reales** — conecta una parte con dos, nombra cada borde y los nombres se convierten en los botones de elección en pantalla.
- **Parte única o serie** — reproduce una parte y detente, o sigue el grafo por todas las ramas hasta que termine.
- **Gestión de partes rápida** — renombrar, duplicar, eliminar, seleccionar varias, copiar / pegar y arrastrar para reordenar; arrastra un tirador al espacio vacío para crear la siguiente parte ya conectada.
- **La timeline sigue siendo la timeline** — las ramas cambian qué se reproduce después, no cómo se edita, se deshace o se exporta una parte.

<p align="center">
  <img src="./assets/screenshots/08-episodes.jpg" width="100%" alt="El espacio de trabajo Episodes en vista de flujo: cuatro partes conectadas por ramas etiquetadas, y cada tarjeta muestra su portada y su duración">
</p>

### Plugins OFX — Trae tus propios efectos

AI Cut aloja plugins **OpenFX (OFX) 1.5.1**, así que las herramientas de acabado que ya tienes te acompañan: corrección de color, desenfoques, resplandores, keyers, deformaciones, transiciones. Un gestor de plugins explora el [AI Cut OFX Registry](https://github.com/heshengtao/ai-cut-ofx-registry) con verificación SHA-256 y también detecta plugins instalados en otras ubicaciones del disco.

- **Los seis contextos OFX** — filter, general, generator, paint y retimer se enganchan a la cadena de efectos de un clip; transition se engancha al borde de un clip
- **Interfaz propia o parámetros** — abre la interfaz propia del plugin o controla sus parámetros en el panel Parameters dedicado
- **La vista previa se mantiene en vivo** — montar un efecto inicia un pre-bake en segundo plano, así que las vistas previas de video e imagen conservan el aspecto durante la reproducción
- **Se hornea al exportar** — el render aplica cada efecto al tamaño final (paint se controla por parámetros, retimer pide el `SourceTime` al plugin)
- **Registro + importación local** — búsqueda, instalación / actualización / eliminación con un clic, o apuntar a un bundle local

<p align="center">
  <img src="./assets/screenshots/03-ofx.jpg" width="100%" alt="El gestor de descargas OFX con la lista de plugins OpenFX disponibles, sus licencias, las plataformas compatibles y la instalación con un clic">
</p>

### IA y automatización — Convertir el material grabado en algo que puedes seguir editando

Las funciones de IA están pensadas para sesiones reales, no para demos. Apúntalas a un clip y te devuelven algo que puedes seguir editando: una pista de subtítulos que puedes corregir, una voz en off alineada con su tiempo original, una toma de voz más limpia, pistas separadas que puedes reequilibrar. Las herramientas locales se ejecutan en tu propio hardware.

- **Subtítulos** — reconocimiento de voz local que genera una pista de subtítulos editable
- **Voz en off** — TTS local más OpenAI, ElevenLabs, Azure, Google, Baidu, MiniMax, Volcengine o HTTP personalizado
- **Corte inteligente** — las marcas de tiempo por palabra detectan muletillas y pausas largas y las cortan en una sola pasada; las palabras a filtrar, los umbrales de pausa y el margen de los puntos de corte viven en un mismo diálogo de configuración, y los cortes se extienden un poco hacia el silencio circundante para no dejar medio sonido suelto; la transcripción tacha cada palabra eliminada, un clic la restaura y la timeline marca cada corte
- **IA de audio** — igualación de sonoridad, reducción de ruido, pulido de voz, separación de fuentes, traducción de audio
- **IA de video** — superresolución, interpolación de fotogramas, reencuadre inteligente, seguimiento de cámara
- **Sondeo de medios** — una sola llamada devuelve metadatos, muestras de movimiento/corte, cajas de caras/personas y una transcripción local
- **Ciclo de revisión** — importación de `film.json`, notas de revisión estructuradas (`severity`, `sceneId`, `resolved`), detección de segmentos modificados, re-renderizado de rangos con caché por hash de contenido, comparación de tomas (SSIM + fotogramas en paralelo) y hojas de contactos
- **Offline por diseño** — el editor y sus modelos locales no necesitan cuenta ni subidas

<p align="center">
  <img src="./assets/screenshots/04-ai.jpg" width="100%" alt="Funciones de IA: generación de subtítulos, voz en off con IA y generación local de imagen / video, con acciones de descarga y configuración de modelos">
</p>

### Servidor MCP y agente de clip — Deja que un agente de IA trabaje en tu sesión

Activa un interruptor y tu proyecto se convierte en algo que un asistente de IA puede manejar. El servidor **MCP (Model Context Protocol)** integrado expone la sesión por HTTP ligado a `127.0.0.1`: conecta tu agente, dale una tarea y míralo añadir pistas, colocar clips o reescribir texto mientras la interfaz se actualiza en tiempo real. Las mismas definiciones de herramientas también alimentan el **agente de clip** integrado, un panel de chat compatible con OpenAI con streaming, llamadas a herramientas y un árbol de sesiones con ramificaciones.

- **MCP sobre HTTP** — un endpoint solo de loopback, transportes JSON y SSE
- **Ciclo de vida del proyecto** — `new_project` / `open_project` / `save_project` leen y escriben el JSON del proyecto directamente, sin diálogos de guardar/abrir
- **Ediciones en vivo** — las acciones del agente aparecen de inmediato como cambios normales del proyecto
- **CLI `aicut`** — un cliente ligero; las nuevas herramientas no requieren cambios en la CLI
- **`aicut start`** — detecta automáticamente la aplicación instalada y la desvincula del job del lanzador (Windows incluido)
- **Agente de clip** — endpoint compatible con OpenAI, respuestas en streaming, tarjetas de herramientas, ramas de sesión
- **Herramientas de canvas** — crear canvas, aplicar operaciones de board y listar o ejecutar workflows publicados por el mismo endpoint
- **Skills** — documentación de edición y producción cargada a demanda por el agente

<p align="center">
  <img src="./assets/screenshots/05-mcp.jpg" width="100%" alt="El servidor MCP activado con su endpoint de loopback, la entrada del agente de clip y la CLI aicut, junto a la timeline">
</p>

### Exportación y actualizaciones — Terminar y entregar

Cuando el corte está bien, renderízalo. Elige un formato de entrega y AI Cut escribe un archivo listo para publicar en segundo plano mientras sigues trabajando. Las aplicaciones instaladas consultan GitHub Releases en busca de actualizaciones firmadas, así que una nueva versión está a un clic.

- **Formatos** — MP4 / H.264, ProRes 422, GIF
- **Controles de salida** — presets o ancho/alto personalizados, ajuste contain/cover, frecuencia de fotogramas, calidad; paleta, dithering y bucle del GIF
- **Exportación en segundo plano** — progreso en vivo y cancelación
- **Actualización automática firmada** — comprobación al iniciar, comprobación manual, descarga, instalación, reinicio
- **Bundles verificados** — la clave pública del actualizador va incrustada; la clave privada vive solo en el entorno de release

<p align="center">
  <img src="./assets/screenshots/06-export.jpg" width="100%" alt="El diálogo de exportación con presets MP4, ProRes y GIF, resolución, frecuencia de fotogramas, ajuste, calidad y ajustes de audio">
</p>

## Instalación

Los binarios precompilados se publican en la página de [GitHub Releases](https://github.com/heshengtao/ai-cut/releases).

### Requisitos

- Rust (stable) con Cargo
- Node.js ≥ 20 y [pnpm](https://pnpm.io/) (se recomienda pnpm 11)
- Requisitos previos del sistema para Tauri v2 — consulta <https://tauri.app/start/prerequisites/>

### Compilar desde el código fuente

```bash
git clone https://github.com/heshengtao/ai-cut.git
cd ai-cut

pnpm install
pnpm tauri dev        # run the app in development
pnpm tauri build      # produce a release build
```

Otros comandos útiles:

```bash
pnpm build            # type-check the frontend and build it
pnpm test             # unit tests (Vitest)
pnpm fetch:sidecars   # prepare the ffmpeg / ffprobe sidecars
pnpm build:aicut      # build the aicut CLI
```

ffmpeg y ffprobe se distribuyen como binarios estáticos, así que los usuarios no necesitan tener ffmpeg instalado. Los archivos de modelo viven en `src-tauri/resources/models/`; los modelos más grandes se descargan a demanda.

### Carpeta de datos

Los modelos, ONNX Runtime, los plugins OFX, el historial de proyectos y la configuración se guardan por defecto en la carpeta de datos del usuario (`%APPDATA%\com.aicut.editor` en Windows) y pueden sumar varios gigabytes. Hay dos formas de mantenerlos fuera del disco del sistema:

- **Elegirla durante la instalación**: el instalador NSIS de Windows pide una carpeta de datos en una **primera instalación** (las instalaciones silenciosas y las actualizaciones automáticas nunca preguntan). La elección se guarda en `HKCU\Software\AI Cut\DataDir`.
- **Moverla después**: **Configuración → Almacenamiento → Elegir carpeta y migrar**. La aplicación copia los datos actuales a la nueva carpeta y escribe un archivo de puntero; surte efecto **después de reiniciar**. La carpeta antigua se conserva hasta que la limpies desde la misma página: la migración nunca borra nada.

Orden de resolución: `--data-dir <path>` > `AICUT_DATA_DIR` > el puntero de la configuración (`data-dir.json`) > el registro del instalador > el valor predeterminado del sistema. Los dos primeros son el "modo portátil"; la página de configuración desactiva la migración para ellos.

Algunos archivos se quedan deliberadamente donde están: `cli-path` / `app-path` / `mcp-url` son archivos de descubrimiento que la CLI `aicut` y los harness de IA externos encuentran por bundle id (consulta [`skills/aicut/SKILL.md`](skills/aicut/SKILL.md)). Ocupan unas decenas de bytes y permanecen en la carpeta predeterminada.

### Compatibilidad de plataformas

| Plataforma | Estado |
| --- | --- |
| Windows (x86_64) |  Compatible |
| macOS (Apple Silicon) |  Compatible (ver la nota sobre la “aplicación dañada” más abajo) |
| Linux (x86_64 / arm64) |  Compatible |

> **¿macOS dice “la aplicación está dañada”?** La aplicación está firmada ad-hoc (no notarizada), así que macOS
> pone en cuarentena las descargas. Ejecuta esto en Terminal y luego abre la aplicación normalmente:
>
> ```bash
> xattr -cr "/Applications/AI Cut.app"
> ```

> **El pipeline de release actual no soporta los Mac con Intel.** Las compilaciones de release se
> generan solo para Apple Silicon (`aarch64-apple-darwin`).

## Acceso desde el navegador y modo headless

La aplicación de escritorio incorpora un servidor HTTP ligado al loopback: **Configuración → General → Acceso web**,
y luego abre la dirección en un navegador — es el mismo editor. **Sin inicio de sesión, sin token**: abre la dirección y trabaja. El control de acceso es tarea del despliegue
(LAN, red del contenedor o un proxy inverso).

Comparte la sesión en vivo con la aplicación de escritorio: ambos lados son de lectura y escritura, y las ediciones se fusionan en el mismo proyecto. Activa "Acceso por LAN" y reinicia para abrirlo desde una tablet u otra máquina en la misma red.

### Docker

```bash
docker build -t ai-cut .
docker run -d --name ai-cut -p 28440:28440 -p 50563:50563 -v aicut-data:/data ai-cut
```

La imagen está basada en Debian slim (multietapa, ~434 MB) y distribuye el mismo ffmpeg/ffprobe estático que la aplicación de escritorio, además de los 5 modelos incluidos y ONNX Runtime (la arquitectura se comprueba contra la cabecera ELF en tiempo de compilación y se crea un alias `libonnxruntime.so`); abre <http://localhost:28440>.

MCP se enlaza a `0.0.0.0` dentro del contenedor (la semántica de `--lan`), así que tras publicar `50563` un cliente MCP en el host (Claude Desktop / IDE) puede conectarse a `http://<host>:50563/mcp` y obtiene las mismas 62 herramientas que la aplicación de escritorio.

**El contenedor coincide con la aplicación de escritorio** salvo donde la física dice otra cosa:

| Capacidad | Escritorio | Contenedor / navegador |
| --- | --- | --- |
| Edición / subtítulos / exportación / fuentes | ✅ | ✅ misma implementación del daemon |
| Inferencia local: ASR, TTS, reducción de ruido, separación de fuentes, escalado, interpolación, cambio de voz | ✅ | ✅ misma implementación del daemon (CPU, más lento) |
| Gestión de modelos y runtime, imagen/TTS en la nube, sonoridad, procesamiento de video | ✅ | ✅ |
| Agente / MCP | ✅ 62 herramientas | ✅ las mismas 62 herramientas (macros de edición, IA a nivel de clip, exportación y render, ciclo de vida del proyecto, deshacer/rehacer, notas de revisión, manifiestos de film, jobs en segundo plano) |
| Efectos OFX | ✅ incluidos los horneados de clip completo | ✅ vistas previas de fotograma / imagen / transición **y** horneado de clip completo + transición (horneado secuencial en un solo proceso) |
| Instalar / importar / eliminar plugins | ✅ | ✅ (`reveal in file manager` necesita el escritorio) |
| Interfaces nativas de plugins, diálogos del sistema / apertura del navegador | ✅ | ⛔ sin sistema de ventanas / sesión de escritorio |
| Generación local de imagen / video (sd.cpp) | ✅ | ✅ misma implementación del daemon: el motor y los pesos se descargan a demanda; los contenedores usan CPU / Vulkan / ROCm (no hay compilación CUDA para Linux en upstream) |

**Los binarios de los plugins deben coincidir con la arquitectura de la imagen.** La imagen se compila para la
arquitectura de la máquina de compilación (arm64 en Apple Silicon), y los plugins OFX son binarios
nativos: un plugin que solo publica una compilación x86_64 (por ejemplo, Flame LTX AlphaGen) no puede
cargarse en un contenedor arm64. Ahora el editor indica "plugin binary architecture
mismatch" en lugar del críptico `cannot open shared object file`; ejecuta esos plugins
en una imagen amd64:

```bash
docker build --platform linux/amd64 -t ai-cut .
docker run -d --platform linux/amd64 -p 28440:28440 -v aicut-data:/data ai-cut
```

(En Apple Silicon esto pasa por la emulación Rosetta y es más lento; en un host Linux
x86_64 nada cambia.)

Los modelos se descargan en el primer uso (Configuración → Modelos) a través del proxy configurado; los 5 modelos incluidos funcionan de inmediato.

### Binario headless

```bash
cargo run --manifest-path crates/daemon/Cargo.toml --bin aicutd -- \
  --data-dir ./data --port 28440 --lan --dist dist
```

### Variables de entorno

| Variable | Valor predeterminado | Propósito |
| --- | --- | --- |
| `AICUT_DATA_DIR` | `./data` | proyectos, medios importados, exportaciones |
| `AICUT_NO_AUDIO` | sin definir | omitir la apertura de un dispositivo de audio |

### API HTTP

| Método | Ruta | Propósito |
| --- | --- | --- |
| `POST` | `/rpc/{command}` | comandos de edición, los mismos nombres que el IPC de la aplicación |
| `GET` | `/events` | Server-Sent Events: documento + progreso de los jobs |
| `GET` | `/session` | WebSocket: sincronización de la sesión en vivo |
| `GET` | `/file` · `POST /upload` | lectura / importación de medios |
| `GET` | `/health` | comprobación de que el servicio está vivo |

## Arquitectura

```
src-tauri/          Tauri shell: windows, native dialogs, auto-updater
crates/daemon/      backend: document model, media, render engine, HTTP
crates/aicut/       the CLI
src/                Vue 3 frontend — identical for desktop and browser
```

`src/platform/` intercambia el transporte (`Tauri IPC` ↔ `HTTP + WebSocket`) detrás de una sola API, de modo que
cada pantalla funciona en ambas carcasas; la compilación para navegador es la misma aplicación hablando con el mismo
backend por la red.

En modo headless, los proyectos, los medios importados y las exportaciones viven en el directorio de datos; ffmpeg
viene de la imagen.

La IA local (ASR / TTS / reducción de ruido / separación / escalado / cambio de voz), la gestión de modelos y
runtime, los plugins/OFX y el agente de edición **todavía no están conectados al backend headless**
— es deuda de migración, no una frontera del producto. `GET /rpc/capabilities` declara,
por función, si está disponible, si le falta un componente o si aún no está portada, y la interfaz
decide a partir de eso en lugar de adivinar con `isTauri()`.

## Preguntas frecuentes

### ¿AI Cut es gratis?

Sí. AI Cut es de código abierto bajo Apache 2.0. No hay niveles de pago ni funciones bloqueadas.

### ¿Funciona sin conexión?

Sí. La edición, la exportación y los modelos de IA locales se ejecutan en tu máquina. El acceso a la red solo ocurre cuando inicias la descarga de un modelo, buscas actualizaciones o configuras un servicio en la nube, como un endpoint de agente compatible con OpenAI o TTS en la nube.

### ¿Necesito una GPU?

No. Los modelos de IA incluidos se ejecutan en CPU; no hay que configurar CUDA ni controladores. Los modelos más grandes tardan más en máquinas lentas, pero no requieren una GPU. Si tienes una GPU NVIDIA, puedes elegir CUDA 12 o CUDA 13 en Configuración → IA → Backend de ejecución: cualquiera de los dos descarga a demanda un conjunto ONNX Runtime + CUDA totalmente emparejado desde el gestor de descargas, sin necesidad de instalar CUDA en el sistema (reinicia para aplicar).

### ¿Qué modelos de IA vienen con la aplicación?

Los modelos pequeños vienen incluidos en el paquete para que las funciones básicas funcionen de inmediato. Los modelos más grandes —reconocimiento de voz, TTS, separación de fuentes, superresolución e interpolación de fotogramas— se descargan a demanda desde el gestor de modelos de la aplicación y se almacenan fuera del árbol de código. Las licencias —incluidas las de los modelos de video con licencia comunitaria y los pesos no comerciales de FLUX.1 [dev]— se listan en [MODELS.md](MODELS.md).

### ¿Qué formatos de plugins de efectos son compatibles?

**OpenFX (OFX) 1.5.1** — los seis contextos de efecto de imagen (filter, general, generator, paint, retimer, transition). Los plugins pueden venir del registro integrado o de tu propio disco. Los formatos de efectos de audio (VST3 / AU / CLAP) no se alojan: las herramientas de audio propias de AI Cut cubren ganancia, fundidos, tono y mezcla.

### ¿Necesito la aplicación en ejecución para que un agente la maneje?

Sí. La Skill y la CLI `aicut` hablan con un AI Cut en ejecución a través de MCP, así que inicia primero la aplicación (`aicut status` te dirá si está activa).

### ¿Puedo hacer un video con ramificaciones?

Sí. Un proyecto puede contener varias partes; la vista Episodes las conecta con bordes etiquetados y el modo "Series" de la vista previa sigue esos bordes. Al final de una parte, las etiquetas salientes aparecen como botones de elección, así que la siguiente parte se elige en pantalla.

### ¿Necesito un modelo para usar el canvas?

No. Los nodes de entrada, visualización, valor, bucle y workflow funcionan sin ningún modelo. Los nodes de modelo necesitan un modelo local o un proveedor en la nube configurado; hasta que uno esté listo, el resto del grafo sigue siendo editable y se puede guardar.

### ¿Puede un agente exportar el video final?

Sí. `export_video` renderiza la timeline a través de MCP: MP4, ProRes o GIF. `outputPath` es opcional: si se omite, AI Cut escribe junto al archivo del proyecto (o en tu carpeta Descargas si el proyecto no está guardado) y devuelve la ruta final. Los subtítulos, la voz en off, la IA de audio / video y la exportación están disponibles como herramientas, así que el agente puede preparar la timeline, renderizarla y entregar el archivo para su revisión.

## Apóyanos

### ¡Danos una estrella!
⭐ ¡Tu apoyo es la fuerza que nos impulsa a seguir adelante!

### ¡Se agradecen las propinas!
<div align="center" style="display: flex; gap: 20px; justify-content: center; flex-wrap: wrap;">

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/agentparty)
[![爱发电](https://img.shields.io/badge/爱发电-支持我们-946ce6?style=for-the-badge&logo=affine&logoColor=white)](https://afdian.com/a/agentparty)

</div>

### Síguenos
<div align="center">
  <a href="https://space.bilibili.com/26978344">
    <img src="screenshots/B.png" width="100" height="100" style="border-radius: 80%; overflow: hidden;" alt="bilibili"/>
  </a>
  <a href="https://www.youtube.com/@agentParty">
    <img src="screenshots/YT.png" width="100" height="100" style="border-radius: 80%; overflow: hidden;" alt="youtube"/>
  </a>
</div>

### Únete a la comunidad
Si tienes alguna pregunta o algún problema con el proyecto, eres bienvenido a unirte a nuestra comunidad.

1. Grupo de QQ: `931057213` (lleno) / `902882342` (Grupo 2)

2. Discord: [Enlace de Discord](https://discord.gg/f2dsAKKr2V)

## Colaboradores

<a href="https://github.com/heshengtao/ai-cut/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=heshengtao/ai-cut" alt="Colaboradores de heshengtao/ai-cut" />
</a>

## Licencia

El **código** de la aplicación es Apache-2.0 — consulta [LICENSE](LICENSE).

Los **pesos** de los modelos son una capa aparte: el repositorio y los instaladores solo incluyen los
cinco modelos permisivos pequeños que vienen con la aplicación; todo lo demás se descarga a
demanda desde su editor y se verifica con un `sha256` fijado. Cada modelo conserva su
propia licencia — consulta **[MODELS.md](MODELS.md)** para la tabla completa, incluidas las licencias
comunitarias (LTX-2, Hunyuan, MiniMax-H3), los modelos CreativeML Open RAIL y los
pesos no comerciales de FLUX.1 [dev].

## Licencias de terceros

Este proyecto se apoya en software de código abierto de terceros. Las licencias de las dependencias se declaran
en `package.json`, `src-tauri/Cargo.toml` y los manifiestos bajo `crates/`. Los binarios
de FFmpeg incluidos mantienen sus propias licencias upstream. Los pesos de los modelos —incluidos y a demanda,
con sus licencias, fuentes y restricciones— se listan en [MODELS.md](MODELS.md); los textos
literales de los modelos incluidos están en `src-tauri/resources/models/LICENSES/`.
