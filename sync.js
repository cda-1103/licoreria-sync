require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function sincronizarTodo() {
  // Volvemos a la URL original que te funcionaba
  const urlApi = 'https://api.finapartner.com/api/inventory?pageSize=500';

  console.log("📡 Conectando con la API de Inventario de Fina...");

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

    // Verificamos que json.data sea un array
    if (!json.data || !Array.isArray(json.data)) {
      console.log("⚠️ No se recibió un array en json.data");
      console.log("Respuesta recibida:", JSON.stringify(json).substring(0, 200));
      return;
    }

    const productosFina = json.data;
    console.log(`📦 Encontrados ${productosFina.length} productos en Fina.`);

    // --- PASO 1: Categorías ---
    const categoriasUnicas = new Map();
    productosFina.forEach(p => {
      const nombre = (p.category || 'Sin Categoría').trim();
      const slug = nombre.toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');

      if (!categoriasUnicas.has(slug)) {
        categoriasUnicas.set(slug, nombre);
      }
    });

    const { data: finalCats, error: catError } = await supabase
      .from('categorias')
      .upsert(Array.from(categoriasUnicas).map(([slug, nombre]) => ({ nombre, slug })), { onConflict: 'slug' })
      .select();

    if (catError) throw catError;

    const catMap = {};
    finalCats.forEach(c => {
      catMap[c.nombre.toLowerCase().trim()] = c.id;
    });

    // --- PASO 2: Productos (Con filtro de duplicados por nombre) ---
    const productosVistos = new Set();
    const updates = [];

    productosFina.forEach(prod => {
      // Filtro para evitar "Etiqueta Negra" duplicada
      const nombreNormalizado = prod.name.trim().toLowerCase();
      if (productosVistos.has(nombreNormalizado)) return;
      productosVistos.add(nombreNormalizado);

      const catKey = (prod.category || 'Sin Categoría').toLowerCase().trim();

      updates.push({
        sku: prod.SKU || prod._id, // Si no tiene SKU manual, usamos el ID de Fina
        nombre: prod.name,
        descripcion: prod.description || '',
        precio_usd: prod.sellingPrice || 0,
        stock: prod.amount || 0, // En /inventory el stock es 'amount'
        categoria_id: catMap[catKey] || catMap['sin categoría'],
        actualizado_en: new Date().toISOString()
      });
    });

    console.log(`📤 Sincronizando ${updates.length} productos únicos en Supabase...`);

    const { error: prodError } = await supabase
      .from('productos')
      .upsert(updates, { onConflict: 'sku' });

    if (prodError) throw prodError;

    console.log("✅ ¡Sincronización terminada!");

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
}

sincronizarTodo();