const fs = require("fs");
const YAML = require("yaml");
const _ = require("lodash");

const inputFile = "crediviva.yaml";
const outputDir = "output";

const originalContent = fs.readFileSync(inputFile, "utf8");
const openapi = YAML.parse(originalContent);

// Función recursiva para recolectar $refs
function collectRefs(obj, refSet = new Set()) {
  if (_.isArray(obj)) {
    obj.forEach(item => collectRefs(item, refSet));
  } else if (_.isObject(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      if (key === "$ref" && typeof value === "string") {
        const match = value.match(/^#\/components\/schemas\/(.+)$/);
        if (match) {
          refSet.add(match[1]);
        }
      } else {
        collectRefs(value, refSet);
      }
    }
  }
  return refSet;
}

// Recolectar rutas por tag
const pathsByTag = {};

for (const [path, methods] of Object.entries(openapi.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!operation.tags) continue;
    operation.tags.forEach(tag => {
      if (!pathsByTag[tag]) pathsByTag[tag] = {};
      if (!pathsByTag[tag][path]) pathsByTag[tag][path] = {};
      pathsByTag[tag][path][method] = operation;
    });
  }
}

// Crear carpeta de salida
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// Procesar cada tag
for (const [tag, paths] of Object.entries(pathsByTag)) {
  const partial = {
    openapi: openapi.openapi,
    info: {
      title: `API ${tag}`,
      version: openapi.info.version || "1.0.0",
    },
    servers: openapi.servers,
    paths,
    components: {
      schemas: {},
    },
  };

  // Buscar $refs en las operaciones
  const refSet = collectRefs(paths);

  // Incluir los schemas necesarios
  const added = new Set();

  function addSchemaRecursively(schemaName) {
    if (added.has(schemaName)) return;
    const schema = openapi.components?.schemas?.[schemaName];
    if (schema) {
      partial.components.schemas[schemaName] = schema;
      added.add(schemaName);
      const subRefs = collectRefs(schema);
      subRefs.forEach(addSchemaRecursively);
    }
  }

  refSet.forEach(addSchemaRecursively);

  // Incluir securitySchemes si se usan
  const usedSecuritySchemes = new Set();
  for (const path of Object.values(paths)) {
    for (const method of Object.values(path)) {
      if (method.security) {
        method.security.forEach(sec => {
          Object.keys(sec).forEach(scheme => usedSecuritySchemes.add(scheme));
        });
      }
    }
  }

  if (usedSecuritySchemes.size > 0) {
    partial.components.securitySchemes = {};
    for (const scheme of usedSecuritySchemes) {
      if (openapi.components?.securitySchemes?.[scheme]) {
        partial.components.securitySchemes[scheme] = openapi.components.securitySchemes[scheme];
      }
    }
  }

  // Guardar YAML
  const fileName = tag.toLowerCase().replace(/[^a-z0-9]+/gi, "-") + ".yaml";
  const outPath = `${outputDir}/${fileName}`;
  const yaml = YAML.stringify(partial);
  fs.writeFileSync(outPath, yaml, "utf8");
  console.log(`✅ Generado: ${outPath}`);
}
