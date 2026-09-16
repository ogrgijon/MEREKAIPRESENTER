# Merekai Presenter

[English](README.md) | [Español](README.es.md)

**¿Hay algo más incómodo que llegar a un sitio, empezar una presentación y
ver el escritorio o la barra de tareas en pantalla, incluso en mitad del
evento?**

Para eso hemos creado Merekai Presenter: un reproductor a pantalla completa
para que tus fotografías y vídeos ocupen el protagonismo, mientras tú mantienes
el control de la presentación sin exponer accidentalmente el escritorio.

Convierte una carpeta de archivos multimedia en una presentación cuidada y
fácil de controlar. Elige una carpeta, organiza el contenido, añade una
superposición y deja funcionar el reproductor sin enviar tus archivos a un
servicio en la nube.

Merekai Presenter es una herramienta local para presentar fotografías y vídeos
en galerías, eventos, exposiciones, salas de demostración, aulas, estudios y
señalización digital. Elige una carpeta, organiza la presentación, añade una
superposición y deja funcionar el reproductor a pantalla completa sin enviar
tus archivos a un servicio en la nube.

![Merekai Presenter](iconoMerekaiGallery.png)

## ¿Por qué Merekai Presenter?

Muchas presentaciones empiezan como una carpeta de archivos y después necesitan
un poco más de control: un orden concreto, un título legible, un anuncio
ocasional o la posibilidad de pausar y saltar a un elemento específico.
Merekai Presenter mantiene esos controles cerca de la pantalla y conserva los
archivos y la configuración en el equipo local.

## Funciones principales

- **Reproducción a pantalla completa** para formatos habituales de imagen y
  vídeo
- **Orden por carpetas** para organizar colecciones grandes por carpetas o por
  archivos individuales
- **Control de reproducción en directo** con reproducir, pausar, anterior,
  siguiente, velocidad y selección directa desde la cola
- **Preajustes de presentación** para cambiar rápidamente entre estilos de
  reproducción habituales
- **Superposiciones flexibles** para títulos, subtítulos, etiquetas, formas,
  imágenes y CSS personalizado
- **Texto dinámico** con tokens como nombre de archivo y carpeta principal
- **Inserciones y alertas programadas** para clips o anuncios en puntos
  determinados
- **Funcionamiento local** con la configuración guardada en una base de datos
  SQLite local

## Usos habituales

### Galerías y exposiciones

Selecciona una colección de imágenes, elige una duración cómoda para las
diapositivas y deja el reproductor funcionando a pantalla completa. Usa el
orden por carpetas cuando cada carpeta represente una sala, artista, colección
o capítulo.

### Eventos y presentaciones

Prepara un orden de medios predecible, añade un título o una superposición para
patrocinadores y utiliza los controles de la lista de reproducción para avanzar
durante un evento en directo.

### Salas de demostración y señalización digital

Usa la reproducción aleatoria o en bucle para una pantalla autónoma. Las
inserciones programadas permiten mostrar anuncios o contenido promocional sin
reconstruir la colección principal.

### Enseñanza y revisión en estudio

Mantén los archivos en el equipo, salta entre elementos desde la cola y ajusta
el modo de ajuste, el volumen y la velocidad mientras revisas el material con
un grupo.

## Opciones principales

### Reproducción

- Duración de las diapositivas de imagen
- Volumen de los vídeos
- Reproducir, pausar, anterior y siguiente
- Reproducción más rápida o más lenta
- Modo de ajuste para decidir cómo ocupa la pantalla cada medio
- Reproducción secuencial o aleatoria

### Orden de medios

- Seleccionar una carpeta mediante el selector nativo del sistema
- Ver solo carpetas o carpetas junto con sus archivos
- Reordenar carpetas principales arrastrándolas
- Reordenar archivos individuales arrastrándolos
- Restablecer el orden predeterminado detectado

### Lista de reproducción e inserciones

- Ver el elemento actual, el progreso, la duración y la cola siguiente
- Seleccionar cualquier elemento de la cola para reproducirlo inmediatamente
- Configurar contenido para reproducirlo cada N elementos, después de una
  carpeta o en cada vuelta
- Elegir si una inserción se aplica a la carpeta principal o a una carpeta
  exacta
- Ocultar las superposiciones durante una inserción cuando se necesita un clip
  limpio a pantalla completa
- Activar inserciones y alertas bajo demanda

### Diseñador de superposiciones

- Añadir capas de texto, barra, cuadrado, círculo, imagen o dibujo
- Colocar capas a la izquierda, centro o derecha y arriba, centro o abajo
- Ajustar desplazamiento, tamaño, opacidad, rotación, colores, bordes y radio
- Configurar tipografía, sombras y CSS avanzado
- Usar los tokens `filename` y `parentFolder` en textos dinámicos
- Previsualizar distintas resoluciones y guardar los cambios automáticamente o
  de forma manual

## Cómo funciona

1. Inicia el servidor local.
2. Abre el panel de control y selecciona una carpeta de medios.
3. Configura las opciones de reproducción o aplica un preajuste.
4. Ordena las carpetas o los archivos en **Orden de medios**.
5. Añade superposiciones o inserciones programadas cuando sea necesario.
6. Abre el reproductor a pantalla completa y controla la reproducción desde el
   panel.

El panel de control y el reproductor funcionan desde un único proceso de
Node.js. La interfaz del navegador se comunica con el servidor local mediante
HTTP, mientras que la configuración se guarda en una base de datos SQLite fuera
del repositorio.

## Requisitos

- Node.js 20 o posterior
- npm
- Un navegador para el panel de control

## Instalación

Instala las dependencias del servidor y del panel de control Angular:

```bash
npm install
npm --prefix control-panel install
```

## Compilar y ejecutar

Compila todas las partes del proyecto y después inicia el servidor local:

```bash
npm run build
npm start
```

El panel de control está disponible en `http://127.0.0.1:3131`. Úsalo para
seleccionar una carpeta de medios y configurar la reproducción. El reproductor
está disponible en `http://127.0.0.1:3131/player/`.

Para desarrollo, `npm run dev` compila el proyecto e inicia el servidor. Los
comandos principales de compilación son:

```bash
npm run build:server
npm run build:renderer
npm run build:panel
```

## Reproductor en Raspberry Pi

Para convertir una Raspberry Pi en un reproductor a pantalla completa con su
propio punto de acceso Wi-Fi, consulta la [guía del reproductor en Raspberry
Pi](readme/raspberry-pi.md). Incluye la instalación, la configuración del
punto de acceso, el acceso remoto al panel, el inicio con systemd y el modo
kiosco de Chromium.

## Estructura del proyecto

```text
src/main/       Servidor HTTP de Node.js, configuración y diálogos nativos
src/renderer/   Reproductor a pantalla completa
control-panel/  Panel de control Angular
scripts/        Herramientas de compilación
```

Los datos de la aplicación se guardan fuera del repositorio, en la carpeta de
datos del usuario del sistema operativo. En Windows se encuentra bajo
`%APPDATA%/merekaipresenter`; en Linux y macOS se usa
`$XDG_DATA_HOME/merekaipresenter` o `~/.local/share/merekaipresenter`.

## Seguridad

El servidor escucha en `127.0.0.1` de forma predeterminada y no ofrece acceso
remoto ni autenticación. Mantén esta configuración local salvo que entiendas
los riesgos de cambiar la variable de entorno `HOST`. La API de archivos
locales solo sirve medios dentro de la carpeta configurada y acepta tipos de
imagen y vídeo compatibles.

No subas archivos `.env`, credenciales, certificados, claves privadas, bases de
datos locales ni registros. Las notas internas de trabajo de `prompts/` y
`readme/` están excluidas por `.gitignore`.

## Licencia

Este proyecto se distribuye bajo la [licencia MIT](LICENSE).