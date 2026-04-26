require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// Configuración de Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function sincronizarTodo() {
  if (!process.env.FINA_TOKEN) {
    console.error("❌ ERROR: FINA_TOKEN no definido en el .env");
    return;
  }

  const urlApi = 'https://api.finapartner.com/api/pos/sales/69ee728889942f65ea447c4e?hideOutOfStock=true&location=local';

  console.log("📡 Conectando con la API de Fina...");

  try {
    const response = await fetch(urlApi, {
      headers: {
        'X-Access-Token': process.env.FINA_TOKEN,
        'Accept': 'application/json',
        'Origin': 'https://bbtiendadelicores.finapartner.com',
        'Referer': 'https://bbtiendadelicores.finapartner.com/'
      }
    });

    const json = await response.json();

    // 1. Obtener los productos y el ID del canal actual
    const productosFina = json.data?.salesChannel?.products;
    const currentChannelId = json.data?.sale?.salesChannel?._id;

    if (!productosFina || productosFina.length === 0) {
      console.log("⚠️ No se encontraron productos en la respuesta.");
      return;
    }

    console.log(`📦 Procesando ${productosFina.length} productos de Fina...`);

    // --- PASO 1: Categorías (Únicas por Slug) ---
    const categoriasUnicas = new Map();
    productosFina.forEach(p => {
      const nombre = (p.category && p.category.trim() !== "") ? p.category.trim() : 'Sin Categoría';
      const slug = nombre.toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');

      if (!categoriasUnicas.has(slug)) {
        categoriasUnicas.set(slug, nombre);
      }
    });

    const arrayCategorias = Array.from(categoriasUnicas).map(([slug, nombre]) => ({
      nombre,
      slug
    }));

    const { data: finalCats, error: catError } = await supabase
      .from('categorias')
      .upsert(arrayCategorias, { onConflict: 'slug' })
      .select();

    if (catError) throw catError;

    const catMap = {};
    finalCats.forEach(c => {
      catMap[c.nombre.toLowerCase().trim()] = c.id;
    });

    // --- PASO 2: Productos (Precio por canal y Limpieza de duplicados) ---
    const productosVistos = new Set();
    const updates = [];

    productosFina.forEach(prod => {
      // Evitar duplicados por nombre (Ej: Doble Etiqueta Negra)
      const nombreNormalizado = prod.name.trim().toLowerCase();
      if (productosVistos.has(nombreNormalizado)) return;
      productosVistos.add(nombreNormalizado);

      // Buscar el precio específico para este canal de ventas
      let precioCorrecto = prod.sellingPrice || 0;
      if (currentChannelId && prod.salesChannels) {
        const configCanal = prod.salesChannels.find(c => c.salesChannelId === currentChannelId);
        if (configCanal && configCanal.sellingPrice !== undefined) {
          precioCorrecto = configCanal.sellingPrice;
        }
      }

      const nombreCatKey = (prod.category && prod.category.trim() !== "")
        ? prod.category.toLowerCase().trim()
        : 'sin categoría';

      updates.push({
        sku: (prod.SKU && prod.SKU !== "") ? prod.SKU : prod._id,
        nombre: prod.name,
        descripcion: prod.description || '',
        precio_usd: precioCorrecto,
        stock: prod.totalStock || 0,
        categoria_id: catMap[nombreCatKey],
        actualizado_en: new Date().toISOString()
      });
    });

    console.log(`📤 Sincronizando ${updates.length} productos únicos en Supabase...`);

    const { error: prodError } = await supabase
      .from('productos')
      .upsert(updates, { onConflict: 'sku' });

    if (prodError) throw prodError;

    console.log("✅ ¡Sincronización exitosa y limpia!");

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
}

sincronizarTodo();